/**
 * Engine API Routes — Range Engine, Decision, Health, Pipeline
 *
 * New endpoints that DO NOT modify any existing routes.
 * Mounted at /engine/* in index.ts
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  computeRange, computeGlobal, classifyPosition, calculateOverlap,
  healthEngine, decisionEngine, triggerEngine, riskEngine, entryEngine,
  simulationEngine, pipelineOrchestrator, configManager,
  SUPPORTED_INDICES,
  type RangeEngineInput, type ScannerSignal, type TriggerContext, type EntryContext,
} from '../services/engines';
import { marketRangeService } from '../services/marketRangeService';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { readEngineAuditLines } from '../services/engineAudit';
import { runPipelineCycleOnce } from '../services/pipelineRunner';

const router = Router();

router.use(authenticate);

/** Simulation read APIs: admins always; others need server PIN unlock */
function requireSimRead(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role === 'superadmin' || req.user?.role === 'admin') {
    next();
    return;
  }
  if (simulationEngine.isUnlocked()) {
    next();
    return;
  }
  res.status(403).json({
    success: false,
    error: 'Unlock simulation with PIN (Engine page) or sign in as admin',
  });
}

// ─────────────────────────────────────────────────────────────
//  RANGE ENGINE (§53-55)
// ─────────────────────────────────────────────────────────────

/**
 * POST /engine/range/compute
 * Compute range analysis from raw input
 */
router.post('/range/compute', (req: Request, res: Response) => {
  try {
    const input: Partial<RangeEngineInput> = req.body;
    const output = computeRange(input);
    res.json({ success: true, data: output });
  } catch (error) {
    console.error('Range compute error:', error);
    res.status(500).json({ success: false, error: 'Range computation failed' });
  }
});

/**
 * GET /engine/range/:symbol
 * Get computed range analysis for an index using live data
 */
router.get('/range/:symbol', async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol).toUpperCase();
    const timeframe = (req.query.timeframe as string || 'daily').toLowerCase();

    const rangeData = await marketRangeService.getIndexRangeData(symbol);
    if (!rangeData) {
      return res.json({ success: false, error: 'No range data available' });
    }

    const tf = timeframe === 'weekly' ? rangeData.weekly
             : timeframe === 'monthly' ? rangeData.monthly
             : rangeData.daily;

    const spotPrice = rangeData.spotPrice;
    const atrPos = classifyPosition(spotPrice, tf.atr.highRange, tf.atr.lowRange);
    const emPos = classifyPosition(spotPrice, tf.expectedMove.upperBound, tf.expectedMove.lowerBound);
    const overlap = calculateOverlap(tf.atr.highRange, tf.atr.lowRange, tf.expectedMove.upperBound, tf.expectedMove.lowerBound);

    const input: RangeEngineInput = {
      atrPosition: atrPos,
      emPosition: emPos,
      overlap,
      atrWidth: tf.atr.rangeWidth,
      emWidth: tf.expectedMove.upperBound - tf.expectedMove.lowerBound,
      rangeType: timeframe === 'weekly' ? 'WEEKLY' : timeframe === 'monthly' ? 'MONTHLY' : 'DAILY',
      spotPrice,
    };

    const output = computeRange(input);

    res.json({
      success: true,
      data: {
        ...output,
        input,
        raw: {
          spotPrice,
          atrHigh: tf.atr.highRange,
          atrLow: tf.atr.lowRange,
          emHigh: tf.expectedMove.upperBound,
          emLow: tf.expectedMove.lowerBound,
          overlap,
        },
      },
    });
  } catch (error) {
    console.error('Range fetch error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch range data' });
  }
});

/**
 * GET /engine/range/global
 * Get global market classification across all indices
 */
router.get('/range/global', async (req: Request, res: Response) => {
  try {
    const indexResults: Record<string, any> = {};

    for (const symbol of SUPPORTED_INDICES) {
      try {
        const rangeData = await marketRangeService.getIndexRangeData(symbol);
        if (!rangeData) continue;

        const tf = rangeData.daily;
        const spotPrice = rangeData.spotPrice;
        const atrPos = classifyPosition(spotPrice, tf.atr.highRange, tf.atr.lowRange);
        const emPos = classifyPosition(spotPrice, tf.expectedMove.upperBound, tf.expectedMove.lowerBound);
        const overlap = calculateOverlap(tf.atr.highRange, tf.atr.lowRange, tf.expectedMove.upperBound, tf.expectedMove.lowerBound);

        indexResults[symbol] = computeRange({
          atrPosition: atrPos,
          emPosition: emPos,
          overlap,
          atrWidth: tf.atr.rangeWidth,
          emWidth: tf.expectedMove.upperBound - tf.expectedMove.lowerBound,
          rangeType: 'DAILY',
          spotPrice,
        });
      } catch (e) {
        console.error(`Range global error for ${symbol}:`, e);
      }
    }

    const global = computeGlobal(indexResults);
    res.json({ success: true, data: global });
  } catch (error) {
    console.error('Global range error:', error);
    res.status(500).json({ success: false, error: 'Failed to compute global range' });
  }
});

// ─────────────────────────────────────────────────────────────
//  HEALTH ENGINE
// ─────────────────────────────────────────────────────────────

/**
 * GET /engine/health
 * Get current system health status
 */
router.get('/health', (req: Request, res: Response) => {
  try {
    const vixRaw = req.query.vix;
    const vix = vixRaw != null && vixRaw !== '' ? parseFloat(String(vixRaw)) : undefined;
    const health = healthEngine.evaluate(Number.isFinite(vix as number) ? { vix: vix as number } : undefined);
    res.json({ success: true, data: health });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Health check failed' });
  }
});

/**
 * GET /engine/health/rejections
 * Get recent rejection log
 */
router.get('/health/rejections', (req: Request, res: Response) => {
  try {
    const count = parseInt(req.query.count as string) || 20;
    const rejections = healthEngine.getRecentRejections(count);
    res.json({ success: true, data: rejections });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get rejections' });
  }
});

/**
 * POST /engine/health/override
 * Set health override for testing (§172)
 */
router.post('/health/override', authorize('superadmin', 'admin'), (req: Request, res: Response) => {
  try {
    const { enabled, mode } = req.body;
    healthEngine.setOverride(!!enabled, mode);
    res.json({ success: true, message: `Override ${enabled ? 'enabled' : 'disabled'}` });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to set override' });
  }
});

// ─────────────────────────────────────────────────────────────
//  DECISION ENGINE
// ─────────────────────────────────────────────────────────────

/**
 * GET /engine/decision/:symbol
 * Get last decision for a symbol
 */
router.get('/decision/:symbol', (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol).toUpperCase();
    const decision = decisionEngine.getLastDecision(symbol);
    res.json({ success: true, data: decision });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get decision' });
  }
});

// ─────────────────────────────────────────────────────────────
//  PIPELINE
// ─────────────────────────────────────────────────────────────

/**
 * GET /engine/pipeline/:symbol
 * Get pipeline summary for a symbol
 */
router.get('/pipeline/:symbol', (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol).toUpperCase();
    const summary = pipelineOrchestrator.getPipelineSummary(symbol);
    res.json({ success: true, data: summary });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Pipeline summary failed' });
  }
});

// ─────────────────────────────────────────────────────────────
//  SIMULATION
// ─────────────────────────────────────────────────────────────

/**
 * POST /engine/simulation/verify-pin
 * Verify PIN to unlock simulation panel (§173-174)
 */
router.post('/simulation/verify-pin', (req: Request, res: Response) => {
  try {
    const { pin } = req.body;
    const verified = simulationEngine.verifyPin(pin);
    res.json({ success: true, data: { verified } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'PIN verification failed' });
  }
});

/**
 * POST /engine/simulation/lock
 * Lock simulation panel (§177)
 */
router.post('/simulation/lock', (req: Request, res: Response) => {
  simulationEngine.lockPanel();
  res.json({ success: true, message: 'Panel locked' });
});

/**
 * GET /engine/simulation/account
 * Get simulation account summary (§264)
 */
router.get('/simulation/account', requireSimRead, (req: Request, res: Response) => {
  try {
    const account = simulationEngine.getAccount();
    res.json({ success: true, data: account });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get account' });
  }
});

/**
 * GET /engine/simulation/trades/open
 * Get open trades (§265)
 */
router.get('/simulation/trades/open', requireSimRead, (req: Request, res: Response) => {
  try {
    const trades = simulationEngine.getOpenTrades();
    res.json({ success: true, data: trades });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get trades' });
  }
});

/**
 * GET /engine/simulation/trades/history
 * Get closed trades history (§266-267)
 */
router.get('/simulation/trades/history', requireSimRead, (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const trades = simulationEngine.getClosedTrades(limit);
    res.json({ success: true, data: trades });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get history' });
  }
});

/**
 * GET /engine/simulation/trades/:tradeId
 * Get specific trade detail (§277)
 */
router.get('/simulation/trades/:tradeId', requireSimRead, (req: Request, res: Response) => {
  try {
    const trade = simulationEngine.getTrade(req.params.tradeId);
    res.json({ success: true, data: trade });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get trade' });
  }
});

/**
 * GET /engine/simulation/rejections
 * Get recent rejection log (§268-269)
 */
router.get('/simulation/rejections', requireSimRead, (req: Request, res: Response) => {
  try {
    const count = parseInt(req.query.count as string) || 10;
    const rejections = simulationEngine.getRecentRejections(count);
    res.json({ success: true, data: rejections });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get rejections' });
  }
});

/**
 * GET /engine/simulation/performance
 * Get performance metrics (§270)
 */
router.get('/simulation/performance', requireSimRead, (req: Request, res: Response) => {
  try {
    const metrics = simulationEngine.getPerformance();
    res.json({ success: true, data: metrics });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get performance' });
  }
});

/**
 * POST /engine/simulation/reset
 * Reset simulation (clears all trades and capital)
 */
router.post('/simulation/reset', authorize('superadmin', 'admin'), (req: Request, res: Response) => {
  try {
    simulationEngine.reset();
    res.json({ success: true, message: 'Simulation reset' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Reset failed' });
  }
});

/**
 * POST /engine/simulation/mode
 * Toggle simulation mode (§271-272)
 */
router.post('/simulation/mode', authorize('superadmin', 'admin'), (req: Request, res: Response) => {
  try {
    const { mode } = req.body;
    if (mode === 'SIMULATION' || mode === 'LIVE') {
      simulationEngine.setMode(mode);
      res.json({ success: true, data: { mode } });
    } else {
      res.json({ success: false, error: 'Invalid mode' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: 'Mode change failed' });
  }
});

// ─────────────────────────────────────────────────────────────
//  CONFIG (§290)
// ─────────────────────────────────────────────────────────────

/**
 * GET /engine/config
 * Get current configuration
 */
router.get('/config', (req: Request, res: Response) => {
  try {
    const config = configManager.getConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get config' });
  }
});

/**
 * POST /engine/config/reset — must be registered before /config/:section
 */
router.post('/config/reset', authorize('superadmin', 'admin'), (req: Request, res: Response) => {
  try {
    configManager.reset();
    res.json({ success: true, message: 'Config reset to defaults' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Config reset failed' });
  }
});

/**
 * POST /engine/config/:section
 * Update a config section dynamically
 */
router.post('/config/:section', authorize('superadmin', 'admin'), (req: Request, res: Response) => {
  try {
    const section = req.params.section as any;
    const updates = req.body;
    configManager.updateSection(section, updates);
    res.json({ success: true, message: `Config section '${section}' updated` });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Config update failed' });
  }
});

// ─────────────────────────────────────────────────────────────
//  RISK
// ─────────────────────────────────────────────────────────────

/**
 * GET /engine/risk/state
 * Get current risk state
 */
router.get('/risk/state', (req: Request, res: Response) => {
  try {
    const state = riskEngine.getState();
    res.json({ success: true, data: state });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get risk state' });
  }
});

/**
 * POST /engine/risk/reset-daily
 * Reset daily risk counters
 */
router.post('/risk/reset-daily', authorize('superadmin', 'admin'), (req: Request, res: Response) => {
  try {
    riskEngine.resetDaily();
    res.json({ success: true, message: 'Daily risk counters reset' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Reset failed' });
  }
});

/**
 * GET /engine/audit — recent pipeline / engine audit lines (admin)
 */
router.get('/audit', authorize('superadmin', 'admin'), async (req: Request, res: Response) => {
  try {
    const max = Math.min(parseInt(req.query.max as string) || 200, 1000);
    const lines = await readEngineAuditLines(max);
    res.json({ success: true, data: lines });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to read audit log' });
  }
});

/**
 * POST /engine/pipeline/run-once — manual pipeline tick (admin)
 */
router.post('/pipeline/run-once', authorize('superadmin', 'admin'), async (_req: Request, res: Response) => {
  try {
    await runPipelineCycleOnce();
    res.json({ success: true, message: 'Pipeline cycle completed' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Pipeline run failed' });
  }
});

export default router;
