/**
 * Exit Engine API Routes — v2
 */

import { Router, Request, Response } from 'express';
import {
  exitEngineService,
  TradePosition,
  OneMinCandle,
} from '../services/exitEngine';
import { getDhanStream } from '../services/dhanClient';

const router = Router();

// 
//  GET /exit/positions — fetch real F&O option positions from Dhan API
//  Converts Dhan position format to TradePosition format for exit evaluation
// 
router.get('/positions', async (_req: Request, res: Response) => {
  try {
    const dhanClient = getDhanStream();
    const rawPositions = await dhanClient.getPositions();

    if (!rawPositions || rawPositions.length === 0) {
      return res.json({ success: true, data: { positions: [], count: 0 } });
    }

    // Map underlying symbols from tradingSymbol (e.g. "NIFTY-Mar2026-25000-CE" → "NIFTY")
    const extractUnderlying = (tradingSymbol: string): string => {
      if (!tradingSymbol) return 'UNKNOWN';
      // Common Dhan FNO trading symbol formats:
      // "NIFTY-25MAR2026-25000-CE", "BANKNIFTY 27MAR2026 CE 52000.00", etc.
      const upper = tradingSymbol.toUpperCase();
      const knownUnderlyings = ['BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'MIDCAPNIFTY', 'SENSEX', 'BANKEX', 'NIFTY'];
      for (const sym of knownUnderlyings) {
        if (upper.startsWith(sym)) return sym === 'MIDCPNIFTY' ? 'MIDCAPNIFTY' : sym;
      }
      // Fallback: take first part before space or hyphen
      return upper.split(/[\s\-]/)[0] || 'UNKNOWN';
    };

    // Convert Dhan positions to TradePosition format
    const tradePositions: TradePosition[] = rawPositions.map((pos: any) => {
      const isLong = (pos.netQty || 0) > 0;
      const entryPrice = isLong ? (pos.buyAvg || pos.costPrice || 0) : (pos.sellAvg || pos.costPrice || 0);
      // Approximate current price from unrealized P&L
      const qty = Math.abs(pos.netQty || 0);
      const unrealized = pos.unrealizedProfit || 0;
      const currentPrice = qty > 0 ? entryPrice + (unrealized / qty) * (isLong ? 1 : -1) : entryPrice;

      const optionType: 'CE' | 'PE' = pos.drvOptionType === 'CALL' ? 'CE' : 'PE';
      const symbol = extractUnderlying(pos.tradingSymbol || '');

      return {
        id: pos.securityId || `${pos.tradingSymbol}_${Date.now()}`,
        symbol,
        strike: pos.drvStrikePrice || 0,
        optionType,
        entryPrice: parseFloat(entryPrice.toFixed(2)),
        currentPrice: parseFloat(currentPrice.toFixed(2)),
        quantity: qty,
        entryTime: Date.now(), // Dhan doesn't give exact entry time for intraday — use current
        highestPrice: currentPrice > entryPrice ? currentPrice : entryPrice,
      } as TradePosition;
    });

    // Also run exit evaluation on all positions
    const spotPriceMap: Record<string, number> = {};
    const uniqueSymbols = [...new Set(tradePositions.map(p => p.symbol))];
    for (const sym of uniqueSymbols) {
      try {
        const spotPrice = await dhanClient.getSpotPrice(sym);
        spotPriceMap[sym] = spotPrice;
      } catch {
        spotPriceMap[sym] = 0;
      }
    }

    // Evaluate each position with appropriate spot price
    const evaluated = tradePositions.map(pos => {
      const spotPrice = spotPriceMap[pos.symbol] || 0;
      const signal = exitEngineService.evaluatePosition(pos, spotPrice);
      return { position: pos, signal };
    });

    res.json({
      success: true,
      data: {
        positions: tradePositions,
        evaluated,
        count: tradePositions.length,
        spotPrices: spotPriceMap,
      },
    });
  } catch (error) {
    console.error('Error fetching positions:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch positions' });
  }
});

// 
//  GET /exit/risk — current risk parameters + cutoff timers
// 
router.get('/risk', (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        risk: exitEngineService.getRisk(),
        timeToGammaCutoff: exitEngineService.getTimeToGammaCutoff(),
        timeToThetaCutoff: exitEngineService.getTimeToThetaCutoff(),
        timeToPremiumCutoff: exitEngineService.getTimeToPremiumCutoff(),
      },
    });
  } catch (error) {
    console.error('Error fetching risk params:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch risk params' });
  }
});

// 
//  POST /exit/risk — update risk parameters
// 
router.post('/risk', (req: Request, res: Response) => {
  try {
    exitEngineService.setRisk(req.body);
    res.json({ success: true, data: { risk: exitEngineService.getRisk() } });
  } catch (error) {
    console.error('Error updating risk params:', error);
    res.status(500).json({ success: false, error: 'Failed to update risk params' });
  }
});

// 
//  POST /exit/candle — push a 1-minute candle (called by market data poller)
// 
router.post('/candle', (req: Request, res: Response) => {
  try {
    const { symbol, candle } = req.body as { symbol: string; candle: OneMinCandle };
    if (!symbol || !candle) {
      return res.status(400).json({ success: false, error: 'symbol and candle required' });
    }
    exitEngineService.pushCandle(symbol, candle);
    res.json({ success: true, candleCount: exitEngineService.getCandles(symbol).length });
  } catch (error) {
    console.error('Error pushing candle:', error);
    res.status(500).json({ success: false, error: 'Failed to push candle' });
  }
});

// 
//  POST /exit/evaluate — evaluate a single position
// 
router.post('/evaluate', (req: Request, res: Response) => {
  try {
    const { position, spotPrice } = req.body as { position: TradePosition; spotPrice?: number };
    if (!position || !position.entryPrice) {
      return res.status(400).json({ success: false, error: 'Invalid position data' });
    }
    const signal = exitEngineService.evaluatePosition(position, spotPrice);
    res.json({ success: true, data: { position, signal } });
  } catch (error) {
    console.error('Error evaluating position:', error);
    res.status(500).json({ success: false, error: 'Failed to evaluate position' });
  }
});

// 
//  POST /exit/summary — evaluate multiple positions
// 
router.post('/summary', (req: Request, res: Response) => {
  try {
    const { positions, spotPrice } = req.body as { positions: TradePosition[]; spotPrice?: number };
    if (!positions || !Array.isArray(positions)) {
      return res.status(400).json({ success: false, error: 'positions array required' });
    }
    const summary = exitEngineService.evaluateAll(positions, spotPrice);
    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('Error generating exit summary:', error);
    res.status(500).json({ success: false, error: 'Failed to generate exit summary' });
  }
});

// 
//  POST /exit/validate-entry — check entry conditions for CE or PE
// 
router.post('/validate-entry', (req: Request, res: Response) => {
  try {
    const result = exitEngineService.validateEntry(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error validating entry:', error);
    res.status(500).json({ success: false, error: 'Failed to validate entry' });
  }
});

// 
//  POST /exit/position-size — risk-based sizing
// 
router.post('/position-size', (req: Request, res: Response) => {
  try {
    const { capital, riskPercent, entryPrice } = req.body;
    if (!capital || !riskPercent || !entryPrice) {
      return res.status(400).json({ success: false, error: 'capital, riskPercent, entryPrice required' });
    }
    const result = exitEngineService.calculatePositionSize(capital, riskPercent, entryPrice);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error calculating position size:', error);
    res.status(500).json({ success: false, error: 'Failed to calculate position size' });
  }
});

// 
//  Backwards compat: GET /exit/rules  alias to /exit/risk
// 
router.get('/rules', (_req: Request, res: Response) => {
  try {
    const risk = exitEngineService.getRisk();
    res.json({
      success: true,
      data: {
        rules: risk,
        timeToKill: exitEngineService.getTimeToThetaCutoff(),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch rules' });
  }
});

router.post('/rules', (req: Request, res: Response) => {
  try {
    exitEngineService.setRisk(req.body);
    res.json({ success: true, data: { rules: exitEngineService.getRisk() } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update rules' });
  }
});

export default router;
