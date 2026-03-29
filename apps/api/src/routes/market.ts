import { Router, Response } from 'express';
import { IndexInfo, OptionChain, SummaryStats, Targets, VixRange } from '@option-dashboard/shared';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getOptionChain, getSummaryStats } from '../services/optionChain';
import { calculateDailyRange, calculateWeeklyRange, calculateMonthlyRange } from '@option-dashboard/shared';
import { getPivotLevels } from '../services/pivot';
import { getDhanStream } from '../services/dhanClient';
import { redisCache } from '../services/redisCache';
import { signalEngineService } from '../services/signalEngine';
import {
  calculateBuiltUp,
  calculatePCR,
  calculateVolumeColor,
  calculateOIColor,
  filterStrikeRange,
  findHighestVolumes,
  findHighestOI,
  findATMStrike,
  type StrikeData,
} from '../utils/optionChain.utils';
import {
  calculateTimeValue,
  calculateImpliedVolatility,
  getTimeToExpiry,
} from '../utils/optionsPricing';
import {
  calculateCallGreeks,
  calculatePutGreeks,
} from '@option-dashboard/shared';
import { marketDataPoller } from '../services/marketDataPoller';

const router = Router();

// Production & optional strict auth: set NODE_ENV=production or REQUIRE_MARKET_AUTH=true
const requireMarketAuth =
  process.env.NODE_ENV === 'production' || process.env.REQUIRE_MARKET_AUTH === 'true';
if (requireMarketAuth) {
  router.use(authenticate);
}

/**
 * GET /market/indices
 * Get list of available indices with current spot prices
 */
router.get('/indices', (req: AuthRequest, res: Response) => {
  const indices: IndexInfo[] = [
    { label: 'NIFTY 50', name: 'nifty50', hasDropdown: true, expiries: [] },
    { label: 'BANK NIFTY', name: 'banknifty', hasDropdown: true, expiries: [] },
    { label: 'FIN NIFTY', name: 'finnifty', hasDropdown: true, expiries: [] },
    { label: 'MIDCAP NIFTY', name: 'midcapnifty', hasDropdown: true, expiries: [] },
    { label: 'SENSEX', name: 'sensex', hasDropdown: true, expiries: [] },
    { label: 'BANKEX', name: 'bankex', hasDropdown: true, expiries: [] },
    { label: 'FNO', name: 'fno', hasDropdown: false },
    { label: 'IV', name: 'iv', hasDropdown: false },
    { label: 'Monthly Range', name: 'monthly_range', hasDropdown: false },
    { label: 'Weekly Range', name: 'weekly_range', hasDropdown: false },
    { label: 'Daily Range', name: 'daily_range', hasDropdown: false },
  ];

  res.json(indices);
});

/**
 * GET /market/option-chain
 * Get option chain for specified index and expiry
 */
router.get('/option-chain', async (req: AuthRequest, res: Response) => {
  try {
    const { index = 'nifty50', expiry } = req.query;
    
    const chain = await getOptionChain(
      index as string,
      expiry as string | undefined
    );
    
    // Update signal engine cache with the fetched data
    const spotPrice = (chain as any).spot || (chain as any).spotPrice || 0;
    signalEngineService.updateCache(index as string, expiry as string | undefined, chain, spotPrice);
    
    res.json(chain);
  } catch (error) {
    console.error('Error fetching option chain:', error);
    res.status(500).json({ error: 'Failed to fetch option chain' });
  }
});

/**
 * GET /market/summary
 * Get summary statistics (totals, PCR, Greeks)
 */
router.get('/summary', async (req: AuthRequest, res: Response) => {
  try {
    const { index = 'nifty50', expiry } = req.query;
    
    const stats = await getSummaryStats(
      index as string,
      expiry as string | undefined
    );
    
    res.json(stats);
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

/**
 * GET /market/ranges
 * Get VIX-based ranges for daily/weekly/monthly
 */
router.get('/ranges', (req: AuthRequest, res: Response) => {
  try {
    const { spot = 18000, vix = 15 } = req.query;
    
    const spotPrice = Number(spot);
    const vixValue = Number(vix);
    
    const ranges = {
      daily: calculateDailyRange(spotPrice, vixValue),
      weekly: calculateWeeklyRange(spotPrice, vixValue),
      monthly: calculateMonthlyRange(spotPrice, vixValue),
    };
    
    res.json(ranges);
  } catch (error) {
    console.error('Error calculating ranges:', error);
    res.status(500).json({ error: 'Failed to calculate ranges' });
  }
});

/**
 * GET /market/pivot
 * Get pivot levels for the current period
 */
router.get('/pivot', async (req: AuthRequest, res: Response) => {
  try {
    const { index = 'nifty50' } = req.query;
    
    const pivots = await getPivotLevels(index as string);
    
    res.json(pivots);
  } catch (error) {
    console.error('Error calculating pivots:', error);
    res.status(500).json({ error: 'Failed to calculate pivots' });
  }
});

/**
 * GET /market/spot-price
 * Get real-time spot price for a symbol from Dhan API
 * Falls back to cached data if rate limited
 */
router.get('/spot-price', async (req: AuthRequest, res: Response) => {
  try {
    const { symbol = 'NIFTY' } = req.query;
    const upperSymbol = String(symbol).toUpperCase();
    
    // Try to get from signal engine cache first (may have fresh data)
    const cached = signalEngineService.getCachedOptionChain(upperSymbol);
    if (cached) {
      console.log(`📦 Using cached spot price for ${upperSymbol}: ${cached.spotPrice}`);
      return res.json({ 
        symbol: upperSymbol,
        spotPrice: cached.spotPrice,
        timestamp: new Date(cached.timestamp).toISOString(),
        source: 'cache'
      });
    }
    
    // Try to fetch fresh data from Dhan
    const dhanClient = getDhanStream();
    try {
      const spotPrice = await dhanClient.getSpotPrice(upperSymbol);
      
      res.json({ 
        symbol: upperSymbol,
        spotPrice,
        timestamp: new Date().toISOString(),
        source: 'dhan'
      });
    } catch (error: any) {
      // If rate limited, return 503 with retry info
      if (error.message?.includes('429')) {
        console.log(`⚠️ Rate limited fetching spot price for ${upperSymbol}, no cache available`);
        return res.status(503).json({ 
          error: 'Service temporarily unavailable',
          message: 'Rate limit exceeded. Data will be available once cache is populated.',
          symbol: upperSymbol,
          retryAfter: 30
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('Error fetching spot price:', error);
    res.status(500).json({ 
      error: 'Failed to fetch spot price',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /market/quotes/:symbol
 * Get current market price (LTP) with change indicators
 * Symbols: NIFTY, BANKNIFTY, FINNIFTY, MIDCAPNIFTY, SENSEX, BANKEX
 */
router.get('/quotes/:symbol', async (req: AuthRequest, res: Response) => {
  try {
    const { symbol } = req.params;
    const upperSymbol = symbol.toUpperCase();
    
    // Validate symbol
    const validSymbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCAPNIFTY', 'SENSEX', 'BANKEX'];
    if (!validSymbols.includes(upperSymbol)) {
      return res.status(400).json({ 
        error: 'Invalid symbol',
        message: `Symbol must be one of: ${validSymbols.join(', ')}`
      });
    }
    
    let ltp = 0;
    let change = 0;
    let changePercent = 0;
    let isRealData = false;

    const dhanClient = getDhanStream();

    // LTP: prefer OHLC feed (same request we use elsewhere); then spot; then cache.
    let ohlc: Awaited<ReturnType<typeof dhanClient.getOHLCData>> = null;
    try {
      ohlc = await dhanClient.getOHLCData(upperSymbol);
      if (ohlc && ohlc.lastPrice > 0) {
        ltp = ohlc.lastPrice;
        isRealData = true;
      }
    } catch {
      /* continue */
    }

    if (ltp <= 0) {
      try {
        ltp = await dhanClient.getSpotPrice(upperSymbol);
        if (ltp > 0) {
          isRealData = true;
          console.log(`✅ Spot LTP for ${upperSymbol}: ${ltp}`);
        } else {
          throw new Error('Spot price returned 0');
        }
      } catch {
        const cached = signalEngineService.getCachedOptionChain(upperSymbol);
        if (cached && cached.spotPrice > 0) {
          ltp = cached.spotPrice;
          isRealData = true;
          console.log(`📦 Using cached spot price for ${upperSymbol}: ${ltp}`);
        } else {
          console.warn(`⚠️  Dhan API failed for ${upperSymbol}, no cached data available`);
          return res.status(503).json({
            error: 'Service temporarily unavailable',
            message: `Unable to fetch real-time data for ${upperSymbol}. Retrying automatically.`,
            retryAfter: 15,
          });
        }
      }
    }

    // Day % vs prev close: Dhan /quote often gives net_change = 0 for IDX_I; /ohlc `close` can track LTP intraday.
    // Daily historical candles give the prior session close — matches NSE-style headline change.
    const fromHistory = await dhanClient.getIndexChangeVsPrevCloseFromDailyHistory(upperSymbol, ltp);
    if (fromHistory) {
      change = fromHistory.change;
      changePercent = fromHistory.changePercent;
      console.log(`✅ Index change from daily history ${upperSymbol}: ${change} (${changePercent}%)`);
    } else {
      const idxQuote = await dhanClient.getIndexMarketQuote(upperSymbol);
      if (idxQuote && idxQuote.lastPrice > 0) {
        ltp = idxQuote.lastPrice;
        const prevClose = ltp - idxQuote.netChange;
        if (prevClose > 0) {
          change = Number(idxQuote.netChange.toFixed(2));
          changePercent = Number(((idxQuote.netChange / prevClose) * 100).toFixed(2));
        }
      }
      if (change === 0 && changePercent === 0 && ohlc && ohlc.close > 0) {
        change = Number((ltp - ohlc.close).toFixed(2));
        changePercent = Number(((change / ohlc.close) * 100).toFixed(2));
      }
    }

    res.json({
      symbol: upperSymbol,
      ltp: parseFloat(ltp.toFixed(2)),
      change,
      changePercent,
      timestamp: Date.now(),
      source: isRealData ? 'dhan' : 'cache',
    });
  } catch (error) {
    console.error('Error fetching quote:', error);
    res.status(500).json({ 
      error: 'Failed to fetch quote',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /market/test-dhan/:symbol
 * Test Dhan API connection and response format
 */
router.get('/test-dhan/:symbol', async (req: AuthRequest, res: Response) => {
  try {
    const { symbol } = req.params;
    const upperSymbol = symbol.toUpperCase();
    
    console.log(`🧪 Testing Dhan API for ${upperSymbol}...`);
    
    const dhanClient = getDhanStream();
    const ltp = await dhanClient.getSpotPrice(upperSymbol);
    
    res.json({
      success: true,
      symbol: upperSymbol,
      ltp,
      message: 'Dhan API connection successful'
    });
  } catch (error) {
    console.error('Dhan API test failed:', error);
    res.status(500).json({
      success: false,
      error: 'Dhan API test failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      details: error
    });
  }
});

/**
 * GET /market/expiries/:symbol
 * Get next 3 expiry dates for an index
 * Uses Dhan option-chain API to extract available expiries
 */
router.get('/expiries/:symbol', async (req: AuthRequest, res: Response) => {
  try {
    const { symbol } = req.params;
    const upperSymbol = symbol.toUpperCase();
    
    // Validate symbol
    const validSymbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCAPNIFTY', 'SENSEX', 'BANKEX'];
    if (!validSymbols.includes(upperSymbol)) {
      return res.status(400).json({ 
        error: 'Invalid symbol',
        message: `Symbol must be one of: ${validSymbols.join(', ')}`
      });
    }
    
    let expiries: Array<{ date: string; label: string }> = [];

    try {
      // Try to fetch real expiries from Dhan API
      const dhanClient = getDhanStream();
      const dhanExpiries = await dhanClient.getExpiries(upperSymbol);
      
      if (dhanExpiries && dhanExpiries.length > 0) {
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
        const nowIST = new Date(now.getTime() + istOffset);
        const currentHourIST = nowIST.getUTCHours();
        const currentMinuteIST = nowIST.getUTCMinutes();
        const isMarketOpen = currentHourIST >= 9 && (currentHourIST < 15 || (currentHourIST === 15 && currentMinuteIST <= 30));
        
        console.log(`📅 Found ${dhanExpiries.length} expiries from Dhan API for ${upperSymbol}`);
        console.log(`🕐 Current IST time: ${nowIST.toISOString().split('T')[1].substring(0, 8)}`);
        console.log(`📊 Market status: ${isMarketOpen ? '✅ OPEN (9:15 AM - 3:30 PM)' : '❌ CLOSED'}`);
        console.log(`\n📋 Expiry Analysis:`);
        
        expiries = dhanExpiries.slice(0, 3).map((expiryDate: string, index: number) => {
          const date = new Date(expiryDate);
          const label = date.toLocaleDateString('en-US', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
          });
          
          // Check if expiry has started trading
          const expiryDateOnly = new Date(date.toISOString().split('T')[0]);
          const todayDateOnly = new Date(nowIST.toISOString().split('T')[0]);
          const isPast = expiryDateOnly < todayDateOnly;
          const isToday = expiryDateOnly.getTime() === todayDateOnly.getTime();
          const isFuture = expiryDateOnly > todayDateOnly;
          
          let tradingStatus = '';
          if (isPast) {
            tradingStatus = '⏮️ EXPIRED - No data available';
          } else if (isToday) {
            if (isMarketOpen) {
              tradingStatus = '✅ TRADING NOW - Real-time data available';
            } else if (currentHourIST < 9 || (currentHourIST === 9 && currentMinuteIST < 15)) {
              tradingStatus = '⏳ Pre-market - Trading starts at 9:15 AM IST';
            } else {
              tradingStatus = '🔒 Market closed - Last traded data available';
            }
          } else if (isFuture) {
            const daysUntil = Math.ceil((expiryDateOnly.getTime() - todayDateOnly.getTime()) / (1000 * 60 * 60 * 24));
            tradingStatus = `⏭️ Starts in ${daysUntil} day${daysUntil > 1 ? 's' : ''} - No data yet (all OI/volume = 0)`;
          }
          
          console.log(`  ${index + 1}. ${label} (${expiryDate}): ${tradingStatus}`);
          
          return { date: expiryDate, label };
        });
        
        console.log(`\n💡 TIP: If you see all zeros, the selected expiry hasn't started trading yet!`);
        console.log(`✅ Real expiries from Dhan for ${upperSymbol}`);
      }
    } catch (dhanError) {
      console.warn(`⚠️ Dhan expiries API failed for ${upperSymbol}:`, dhanError instanceof Error ? dhanError.message : 'Unknown error');
      
      // Return error response indicating API failure
      return res.status(503).json({
        error: 'Dhan API unavailable',
        message: 'Unable to fetch real-time expiries from Dhan API. The endpoint may not be available or requires different authentication.',
        details: dhanError instanceof Error ? dhanError.message : 'Unknown error',
        symbol: upperSymbol
      });
    }

    res.json({
      symbol: upperSymbol,
      expiries,
      source: 'dhan',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`❌ Error fetching expiries for ${req.params.symbol}:`, error);
    res.status(500).json({ 
      error: 'Failed to fetch expiries',
      message: error instanceof Error ? error.message : 'Unknown error',
      symbol: req.params.symbol
    });
  }
});

/**
 * GET /market/ivdex/:symbol
 * Get IVDEX (IV Index) with trend arrow
 * Returns current IV, previous IV, and trend indicator
 */
router.get('/ivdex/:symbol', async (req: AuthRequest, res: Response) => {
  try {
    const { symbol } = req.params;
    const upperSymbol = symbol.toUpperCase();
    
    // Validate symbol
    const validSymbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCAPNIFTY', 'SENSEX', 'BANKEX'];
    if (!validSymbols.includes(upperSymbol)) {
      return res.status(400).json({ 
        error: 'Invalid symbol',
        message: `Symbol must be one of: ${validSymbols.join(', ')}`
      });
    }
    
    let currentIV = 15.0;
    let previousIV = 15.0;
    let isRealData = false;

    try {
      // Try to fetch real IV data from Dhan API
      const dhanClient = getDhanStream();
      const ivData = await dhanClient.getIVData(upperSymbol);
      
      if (ivData && ivData.ltp) {
        currentIV = ivData.ltp;
        isRealData = true;
        console.log(`✅ Real IV data from Dhan for ${upperSymbol}: ${currentIV}`);
        
        // Get previous IV from cache
        const cacheKey = `iv_${upperSymbol}`;
        const cachedIV = await redisCache.getLatest(cacheKey, 'iv');
        if (cachedIV && cachedIV.iv) {
          previousIV = cachedIV.iv;
        } else {
          previousIV = currentIV; // First time, no change
        }
        
        // Store current IV in cache for next comparison
        await redisCache.store(cacheKey, 'iv', { iv: currentIV });
      }
    } catch (dhanError) {
      console.warn(`⚠️  Dhan IV API failed for ${upperSymbol}, using last cached value`);
      // Use last cached IV value as fallback (no mock data)
      const cacheKey = `iv_${upperSymbol}`;
      const cachedIV = await redisCache.getLatest(cacheKey, 'iv');
      if (cachedIV && cachedIV.iv) {
        currentIV = cachedIV.iv;
        previousIV = currentIV; // No change info when using cache
      }
      // If no cache either, currentIV stays 0 indicating no data
    }
    
    const ivChange = currentIV - previousIV;
    
    // Determine trend arrow
    let trend: '▲' | '▼' | '→' = '→';
    let trendColor = '#9e9e9e'; // Grey for neutral
    
    if (ivChange > 0) {
      trend = '▲';
      trendColor = ivChange > 1 ? '#f44336' : '#ff9800'; // Red if >1, Orange otherwise
    } else if (ivChange < 0) {
      trend = '▼';
      trendColor = '#4caf50'; // Green
    }
    
    res.json({
      symbol: upperSymbol,
      currentIV: parseFloat(currentIV.toFixed(2)),
      previousIV: parseFloat(previousIV.toFixed(2)),
      ivChange: parseFloat(ivChange.toFixed(2)),
      trend,
      trendColor,
      timestamp: Date.now(),
      source: isRealData ? 'dhan' : 'cache',
    });
  } catch (error) {
    console.error('Error fetching IVDEX:', error);
    res.status(500).json({ 
      error: 'Failed to fetch IVDEX',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /market/option-chain/:symbol/:expiry
 * Get enriched option chain with real Dhan API data
 * Uses service-level caching to prevent rate limiting
 * Supports interval-based calculations via query parameter: ?interval=5m
 */
router.get('/option-chain/:symbol/:expiry', async (req: AuthRequest, res: Response) => {
  try {
    const { symbol, expiry } = req.params;
    const interval = (req.query.interval as string) || '1D'; // Default to daily
    const upperSymbol = symbol.toUpperCase();
    
    // Validate symbol
    const validSymbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCAPNIFTY', 'SENSEX', 'BANKEX'];
    if (!validSymbols.includes(upperSymbol)) {
      return res.status(400).json({ 
        error: 'Invalid symbol',
        message: `Symbol must be one of: ${validSymbols.join(', ')}`
      });
    }
    
    // Validate interval
    const validIntervals = ['1m', '3m', '5m', '15m', '30m', '60m', '1h', '4h', '1D'];
    if (!validIntervals.includes(interval)) {
      return res.status(400).json({
        error: 'Invalid interval',
        message: `Interval must be one of: ${validIntervals.join(', ')}`
      });
    }
    
    // Use the getOptionChain service which handles Dhan API AND caching
    console.log(`🔵 Route handler: /option-chain/${symbol}/${expiry}?interval=${interval}`);
    const index = upperSymbol === 'NIFTY' ? 'nifty50' : 
                  upperSymbol === 'BANKNIFTY' ? 'banknifty' : 
                  upperSymbol === 'FINNIFTY' ? 'finnifty' : 
                  upperSymbol === 'MIDCAPNIFTY' ? 'midcapnifty' :
                  upperSymbol === 'SENSEX' ? 'sensex' :
                  upperSymbol === 'BANKEX' ? 'bankex' : 'nifty50';
    
    // getOptionChain service handles caching internally now
    const result = await getOptionChain(index, expiry, interval);
    
    return res.json(result);
  } catch (error: any) {
    console.error('Error fetching option chain:', error);
    
    // On rate limit or any API error, try to return stale cached data
    // so the frontend always gets something useful
    const { symbol: sym, expiry: exp } = req.params;
    const upperSym = sym.toUpperCase();
    const symToIndex: Record<string, string> = {
      'NIFTY': 'nifty50', 'BANKNIFTY': 'banknifty', 'FINNIFTY': 'finnifty',
      'MIDCAPNIFTY': 'midcapnifty', 'SENSEX': 'sensex', 'BANKEX': 'bankex',
    };
    const idx = symToIndex[upperSym] || 'nifty50';
    
    // Attempt to serve stale cache from signal engine
    const cachedChain = signalEngineService.getCachedOptionChain(upperSym);
    if (cachedChain) {
      console.log(`📦 Serving stale cached option chain for ${upperSym} (rate limited)`);
      return res.json({
        ...cachedChain,
        _stale: true,
        _staleReason: 'Rate limited — showing last known data',
      });
    }
    
    // Check if it's a rate limit error
    if (error.message && error.message.includes('429')) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded',
        message: 'Dhan API rate limit exceeded. Data will refresh automatically.',
        retryAfter: 30
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch option chain',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /market/polling/start
 * Start real-time polling for a symbol+expiry combination
 */
router.post('/polling/start', (req: AuthRequest, res: Response) => {
  const { symbol, expiry, interval = 2000 } = req.body;

  if (!symbol || !expiry) {
    return res.status(400).json({ error: 'Symbol and expiry are required' });
  }

  try {
    marketDataPoller.startPolling(symbol.toUpperCase(), expiry, interval);
    res.json({ 
      success: true, 
      message: `Started polling for ${symbol} ${expiry}`,
      interval 
    });
  } catch (error) {
    console.error('Error starting polling:', error);
    res.status(500).json({ 
      error: 'Failed to start polling',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /market/polling/stop
 * Stop real-time polling for a symbol+expiry combination
 */
router.post('/polling/stop', (req: AuthRequest, res: Response) => {
  const { symbol, expiry } = req.body;

  if (!symbol || !expiry) {
    return res.status(400).json({ error: 'Symbol and expiry are required' });
  }

  try {
    marketDataPoller.stopPolling(symbol.toUpperCase(), expiry);
    res.json({ 
      success: true, 
      message: `Stopped polling for ${symbol} ${expiry}` 
    });
  } catch (error) {
    console.error('Error stopping polling:', error);
    res.status(500).json({ 
      error: 'Failed to stop polling',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /market/polling/status
 * Get status of active polls
 */
router.get('/polling/status', (req: AuthRequest, res: Response) => {
  try {
    const activePolls = marketDataPoller.getActivePolls();
    res.json({ 
      activePolls,
      count: activePolls.length 
    });
  } catch (error) {
    console.error('Error getting polling status:', error);
    res.status(500).json({ 
      error: 'Failed to get polling status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /market/previous-session/:symbol
 * Get previous session High, Low, Close for pivot calculations
 * Uses Dhan API OHLC data from current session (close = previous close)
 */
router.get('/previous-session/:symbol', async (req: AuthRequest, res: Response) => {
  try {
    const { symbol } = req.params;
    const upperSymbol = symbol.toUpperCase();

    // Fetch real OHLC data from Dhan API
    const dhanClient = getDhanStream();
    let spotPrice: number;
    let ohlcHigh: number;
    let ohlcLow: number;
    let ohlcClose: number;

    try {
      // Use getOHLCData for reliable previous session data (open, high, low, close)
      const ohlcData = await dhanClient.getOHLCData(upperSymbol);
      if (!ohlcData) throw new Error('No OHLC data returned');
      spotPrice = ohlcData.lastPrice || 0;
      ohlcHigh = ohlcData.high || spotPrice;
      ohlcLow = ohlcData.low || spotPrice;
      ohlcClose = ohlcData.close || spotPrice; // close = previous day's close from Dhan
    } catch {
      // If Dhan fails entirely, return 503
      return res.status(503).json({
        error: 'Service temporarily unavailable',
        message: `Unable to fetch session data for ${upperSymbol}. Will retry automatically.`,
        retryAfter: 15,
      });
    }

    res.json({
      symbol: upperSymbol,
      previousSession: {
        high: ohlcHigh,
        low: ohlcLow,
        close: ohlcClose,
        date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      },
      source: 'dhan',
    });
  } catch (error) {
    console.error('Error fetching previous session data:', error);
    res.status(500).json({
      error: 'Failed to fetch previous session data',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
 
