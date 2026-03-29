import { Router, Request, Response } from 'express';
import { signalEngineService } from '../services/signalEngine';

const router = Router();

/**
 * GET /signal/live
 * Get real-time BUY/SELL/NEUTRAL signal for a symbol
 * Query params:
 *   - symbol: NIFTY, BANKNIFTY, FINNIFTY, etc.
 *   - expiry: expiry date (optional, format: YYYY-MM-DD)
 */
router.get('/live', async (req: Request, res: Response) => {
  try {
    const { symbol = 'NIFTY', expiry } = req.query;
    const symbolStr = String(symbol).toUpperCase();
    
    console.log(`📊 Calculating signal for ${symbolStr}, expiry: ${expiry || 'current'}`);
    
    const result = await signalEngineService.calculateSignal(
      symbolStr,
      expiry as string | undefined
    );
    
    res.json(result);
  } catch (error) {
    console.error('Error calculating signal:', error);
    res.status(500).json({
      signal: 'NEUTRAL',
      confidence: 0,
      indicators: null,
      reasons: ['Error calculating signal'],
      error: 'Failed to calculate signal',
    });
  }
});

/**
 * GET /signal/indicators
 * Get all raw indicators without signal evaluation
 * Query params:
 *   - symbol: NIFTY, BANKNIFTY, etc.
 *   - expiry: expiry date (optional)
 */
router.get('/indicators', async (req: Request, res: Response) => {
  try {
    const { symbol = 'NIFTY', expiry } = req.query;
    const symbolStr = String(symbol).toUpperCase();
    
    const result = await signalEngineService.calculateSignal(
      symbolStr,
      expiry as string | undefined
    );
    
    res.json({
      symbol: symbolStr,
      expiry: expiry || 'current',
      indicators: result.indicators,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching indicators:', error);
    res.status(500).json({ error: 'Failed to fetch indicators' });
  }
});

export default router;
