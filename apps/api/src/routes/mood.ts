import { Router, Request, Response } from 'express';
import { moodCalculator, OHLCCandle } from '../services/moodCalculator';
import { oiSpurtService, OIData } from '../services/oiSpurtService';
import { getOptionChain } from '../services/optionChain';
import { signalEngineService } from '../services/signalEngine';
import { getDhanStream } from '../services/dhanClient';

const router = Router();

// Cache for historical candles to prevent excessive API calls
interface CandleCache {
  candles: OHLCCandle[];
  timestamp: number;
}
const candleCache: { [key: string]: CandleCache } = {};
const CANDLE_CACHE_TTL = 60000; // 1 minute cache for historical candles

/**
 * GET /mood/index
 * Get current mood index with optional parameters
 * Query params:
 *   - symbol: NIFTY, BANKNIFTY, etc.
 *   - interval: 1m, 5m, 15m, etc.
 *   - candleCount: number of candles to analyze
 */
router.get('/index', async (req: Request, res: Response) => {
  try {
    const { symbol = 'NIFTY', interval = '5m', candleCount } = req.query;
    const symbolStr = String(symbol).toUpperCase();
    const intervalStr = String(interval);

    // Set candle count if provided
    const count = candleCount ? parseInt(String(candleCount)) : 50;

    // Check cache first
    const cacheKey = `${symbolStr}_${intervalStr}_${count}`;
    const now = Date.now();
    const cached = candleCache[cacheKey];

    let candles: OHLCCandle[];

    if (cached && (now - cached.timestamp) < CANDLE_CACHE_TTL) {
      console.log(`📦 Using cached candles for ${symbolStr} ${intervalStr}`);
      candles = cached.candles;
    } else {
      // Fetch real historical candles from Dhan API
      const dhanClient = getDhanStream();
      candles = await dhanClient.getHistoricalCandles(symbolStr, intervalStr, count);

      if (candles.length > 0) {
        // Cache the candles
        candleCache[cacheKey] = {
          candles,
          timestamp: now,
        };
      }
    }

    const mood = moodCalculator.calculateMood(candles, true);

    res.json({
      symbol: symbolStr,
      interval: intervalStr,
      mood,
      candleCount: candles.length,
    });
  } catch (error) {
    console.error('Error calculating mood index:', error);
    res.status(500).json({ error: 'Failed to calculate mood index' });
  }
});

/**
 * GET /mood/oi-spurt
 * Get current OI spurt alerts
 * Query params:
 *   - symbol: NIFTY, BANKNIFTY, etc.
 *   - expiry: expiry date (optional)
 */
router.get('/oi-spurt', async (req: Request, res: Response) => {
  try {
    const { symbol = 'NIFTY', expiry } = req.query;
    const symbolStr = String(symbol).toUpperCase();

    // Fetch real option chain data from Dhan API
    let oiData: OIData[] = [];
    const now = Date.now();
    
    try {
      const optionChain = await getOptionChain(symbolStr, expiry as string | undefined);
      
      // Convert option chain to OI data format
      if (optionChain && optionChain.rows) {
        optionChain.rows.forEach(row => {
          if (row.ce && row.ce.oi > 0) {
            oiData.push({
              strike: row.strike,
              optionType: 'CE',
              openInterest: row.ce.oi,
              timestamp: now,
            });
          }
          if (row.pe && row.pe.oi > 0) {
            oiData.push({
              strike: row.strike,
              optionType: 'PE',
              openInterest: row.pe.oi,
              timestamp: now,
            });
          }
        });
      }
    } catch (chainError) {
      console.error(`Error fetching option chain for ${symbolStr}:`, chainError);
      // Continue with empty OI data - will return no spurt
    }
    
    // Update OI and detect spurts for this symbol
    const spurt = oiData.length > 0 ? oiSpurtService.updateOI(symbolStr, oiData) : null;

    res.json({
      symbol: symbolStr,
      spurt: spurt || { active: false, strike: '', percent: 0, timestamp: now, optionType: 'CE' },
      lastSpurt: oiSpurtService.getLastSpurt(symbolStr),
    });
  } catch (error) {
    console.error('Error detecting OI spurt:', error);
    res.status(500).json({ error: 'Failed to detect OI spurt' });
  }
});

/**
 * GET /mood/dashboard-data
 * Get all data needed for the dynamic numbers bar
 * Query params:
 *   - symbol: NIFTY, BANKNIFTY, etc.
 *   - interval: 1m, 5m, 15m, etc.
 *   - expiry: expiry date (optional)
 */
router.get('/dashboard-data', async (req: Request, res: Response) => {
  try {
    const { symbol = 'NIFTY', interval = '5m', expiry } = req.query;
    const symbolStr = String(symbol).toUpperCase();
    const intervalStr = String(interval);
    const now = Date.now();

    // Check cache first for historical candles
    const cacheKey = `${symbolStr}_${intervalStr}_50`;
    const cached = candleCache[cacheKey];

    let candles: OHLCCandle[];

    if (cached && (now - cached.timestamp) < CANDLE_CACHE_TTL) {
      console.log(`📦 Using cached candles for dashboard (${symbolStr} ${intervalStr})`);
      candles = cached.candles;
    } else {
      // Fetch real historical candles from Dhan API
      const dhanClient = getDhanStream();
      candles = await dhanClient.getHistoricalCandles(symbolStr, intervalStr, 50);

      if (candles.length > 0) {
        // Cache the candles
        candleCache[cacheKey] = {
          candles,
          timestamp: now,
        };
      }
    }

    // Calculate mood from real/cached candles
    const mood = moodCalculator.calculateMood(candles, true);

    // Try to get option chain from cache first (avoids duplicate API calls)
    let oiData: OIData[] = [];
    let spurt = null;
    
    const cachedOptionChain = signalEngineService.getCachedOptionChain(symbolStr, expiry as string | undefined);
    
    if (cachedOptionChain) {
      // Use cached data - no API call needed!
      console.log(`✅ Using cached option chain for OI spurt (${symbolStr})`);
      const optionChain = cachedOptionChain.data;
      
      // Convert option chain to OI data format
      if (optionChain && optionChain.rows) {
        optionChain.rows.forEach((row: any) => {
          if (row.ce && row.ce.oi > 0) {
            oiData.push({
              strike: row.strike,
              optionType: 'CE',
              openInterest: row.ce.oi,
              timestamp: now,
            });
          }
          if (row.pe && row.pe.oi > 0) {
            oiData.push({
              strike: row.strike,
              optionType: 'PE',
              openInterest: row.pe.oi,
              timestamp: now,
            });
          }
        });
      }
      
      // Check OI spurt for this symbol
      if (oiData.length > 0) {
        spurt = oiSpurtService.updateOI(symbolStr, oiData);
      }
    } else {
      // Cache miss - skip OI spurt for this update to avoid duplicate API calls
      console.log(`⚠️ No cached option chain for OI spurt (${symbolStr}) - skipping for this update`);
      spurt = { active: false, strike: '', percent: 0, timestamp: now, optionType: 'CE' };
    }

    // Calculate next update time (based on interval)
    const intervalSeconds = getIntervalSeconds(interval as string);
    const nextUpdate = intervalSeconds;

    res.json({
      symbol: symbolStr,
      interval,
      mood,
      oiSpurt: spurt || { active: false, strike: '', percent: 0, timestamp: now, optionType: 'CE' },
      nextUpdate,
      timestamp: now,
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});





/**
 * Helper: Get interval in seconds
 */
function getIntervalSeconds(interval: string): number {
  const map: { [key: string]: number } = {
    '1m': 60,
    '3m': 180,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '60m': 3600,
    '1D': 86400,
  };
  return map[interval] || 300;
}

export default router;
