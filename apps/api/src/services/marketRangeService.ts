/**
 * Range + Expected Move Engine — v2
 *
 * REPLACES old pivot-based range calculation with:
 *   1. ATR(14) — Average True Range for Daily / Weekly / Monthly
 *   2. Expected Move = Spot × IV × √(Days / 365) for Daily(1) / Weekly(5) / Monthly(21)
 *   3. Combined Range Analysis panel per index
 *
 * Still uses Dhan API for historical OHLC + IV data.
 */

import { getDhanStream } from './dhanClient';

// ─────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────

export interface OHLCData {
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: number;
}

export interface ATRData {
  atr14: number;          // ATR(14) value — Avg(H-L) over 14 periods
  atrPercent: number;     // ATR as % of close
  pivot: number;          // Pivot = (H + L + C) / 3 of last candle
  highRange: number;      // Pivot + ATR
  lowRange: number;       // Pivot − ATR
  rangeWidth: number;     // 2 × ATR
}

export interface ExpectedMoveData {
  expectedMove: number;         // EM in points
  expectedMovePercent: number;  // EM as % of spot
  upperBound: number;           // Spot + EM
  lowerBound: number;           // Spot - EM
  iv: number;                   // IV used (annualized, decimal)
  daysUsed: number;             // 1, 5, or 21
}

export interface CombinedRangeData {
  atr: ATRData;
  expectedMove: ExpectedMoveData;
}

export interface IndexRangeData {
  symbol: string;
  spotPrice: number;
  daily: CombinedRangeData;
  weekly: CombinedRangeData;
  monthly: CombinedRangeData;
  lastUpdated: number;
}

export interface AllIndicesRangeData {
  indices: IndexRangeData[];
  timestamp: number;
}

// Supported indices
const SUPPORTED_INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCAPNIFTY', 'SENSEX', 'BANKEX'];

// Default IV per index (annualized %) — used as fallback when live IV unavailable
const DEFAULT_IV: Record<string, number> = {
  NIFTY: 13,
  BANKNIFTY: 16,
  FINNIFTY: 12,
  MIDCAPNIFTY: 18,
  SENSEX: 13,
  BANKEX: 15,
};

// ─────────────────────────────────────────────────────────────
//  CACHE
// ─────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const candleCache: Record<string, CacheEntry<OHLCData[]>> = {};
const ivCache: Record<string, CacheEntry<number>> = {};

const CACHE_TTL = {
  candles: 5 * 60 * 1000,     // 5 minutes
  iv: 5 * 60 * 1000,           // 5 minutes
};

// ─────────────────────────────────────────────────────────────
//  ATR(14) CALCULATION
// ─────────────────────────────────────────────────────────────

/**
 * Simplified ATR(14) = Average(High − Low) over last 14 periods.
 * Spec: "Instead of calculating TR for each candle, many dashboards
 * approximate ATR using: ATR ≈ Average(High − Low) over last 14 periods"
 */
function calculateATR14(candles: OHLCData[]): number {
  if (candles.length === 0) return 0;

  // Take last 14 candles (or as many as available)
  const window = candles.slice(-14);
  const ranges = window.map(c => c.high - c.low);
  if (ranges.length === 0) return 0;
  return ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
}

/**
 * Build ATR data for given candles.
 * Spec:
 *   Pivot = (High + Low + Close) / 3  (of last candle)
 *   HighRange = Pivot + ATR
 *   LowRange  = Pivot − ATR
 */
function buildATRData(candles: OHLCData[]): ATRData {
  const atr14 = calculateATR14(candles);
  const last = candles.length > 0 ? candles[candles.length - 1] : null;
  const high = last?.high ?? 0;
  const low = last?.low ?? 0;
  const close = last?.close ?? 0;
  const pivot = (high + low + close) / 3;
  return {
    atr14: Number(atr14.toFixed(2)),
    atrPercent: close > 0 ? Number(((atr14 / close) * 100).toFixed(2)) : 0,
    pivot: Number(pivot.toFixed(2)),
    highRange: Number((pivot + atr14).toFixed(2)),
    lowRange: Number((pivot - atr14).toFixed(2)),
    rangeWidth: Number((2 * atr14).toFixed(2)),
  };
}

// ─────────────────────────────────────────────────────────────
//  EXPECTED MOVE CALCULATION
// ─────────────────────────────────────────────────────────────

/**
 * Expected Move = Spot × IV × √(Days / 365)
 *   Daily:   days = 1
 *   Weekly:  days = 5
 *   Monthly: days = 21
 *
 * IV is annualized implied volatility as decimal (e.g. 0.13 for 13%).
 */
function calculateExpectedMove(spot: number, ivDecimal: number, days: number): ExpectedMoveData {
  const em = spot * ivDecimal * Math.sqrt(days / 365);
  return {
    expectedMove: Number(em.toFixed(2)),
    expectedMovePercent: spot > 0 ? Number(((em / spot) * 100).toFixed(2)) : 0,
    upperBound: Number((spot + em).toFixed(2)),
    lowerBound: Number((spot - em).toFixed(2)),
    iv: Number((ivDecimal * 100).toFixed(2)), // store as %
    daysUsed: days,
  };
}

// ─────────────────────────────────────────────────────────────
//  AGGREGATE WEEKLY / MONTHLY CANDLES
// ─────────────────────────────────────────────────────────────

/**
 * Aggregate daily candles into weekly OHLC bars (Mon-Fri grouping).
 */
function aggregateWeekly(dailyCandles: OHLCData[]): OHLCData[] {
  if (dailyCandles.length === 0) return [];
  
  const weeks: OHLCData[] = [];
  let weekCandles: OHLCData[] = [];
  
  for (const candle of dailyCandles) {
    const day = new Date(candle.timestamp).getDay();
    // If Monday and we have accumulated candles, close the week
    if (day === 1 && weekCandles.length > 0) {
      weeks.push(aggregateGroup(weekCandles));
      weekCandles = [];
    }
    weekCandles.push(candle);
  }
  // Push final partial week
  if (weekCandles.length > 0) {
    weeks.push(aggregateGroup(weekCandles));
  }
  return weeks;
}

/**
 * Aggregate daily candles into monthly OHLC bars.
 */
function aggregateMonthly(dailyCandles: OHLCData[]): OHLCData[] {
  if (dailyCandles.length === 0) return [];
  
  const months: OHLCData[] = [];
  let monthCandles: OHLCData[] = [];
  let currentMonth = new Date(dailyCandles[0].timestamp).getMonth();
  
  for (const candle of dailyCandles) {
    const m = new Date(candle.timestamp).getMonth();
    if (m !== currentMonth && monthCandles.length > 0) {
      months.push(aggregateGroup(monthCandles));
      monthCandles = [];
      currentMonth = m;
    }
    monthCandles.push(candle);
  }
  if (monthCandles.length > 0) {
    months.push(aggregateGroup(monthCandles));
  }
  return months;
}

function aggregateGroup(candles: OHLCData[]): OHLCData {
  return {
    open: candles[0].open,
    high: Math.max(...candles.map(c => c.high)),
    low: Math.min(...candles.map(c => c.low)),
    close: candles[candles.length - 1].close,
    timestamp: candles[candles.length - 1].timestamp,
  };
}

// ─────────────────────────────────────────────────────────────
//  SERVICE
// ─────────────────────────────────────────────────────────────

class MarketRangeService {

  /**
   * Fetch historical daily candles (up to 100 days back) for ATR calculation.
   */
  private async getDailyCandles(symbol: string, count: number = 60): Promise<OHLCData[]> {
    const cacheKey = `${symbol}_daily_${count}`;
    const cached = candleCache[cacheKey];
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL.candles) {
      return cached.data;
    }

    try {
      const dhanClient = getDhanStream();
      const raw = await dhanClient.getHistoricalCandles(symbol, '1D', count);
      if (raw && raw.length > 0) {
        const candles: OHLCData[] = raw.map((c: any) => ({
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          timestamp: c.timestamp || Date.now(),
        }));
        candleCache[cacheKey] = { data: candles, timestamp: Date.now() };
        return candles;
      }
    } catch (error) {
      console.error(`Error fetching daily candles for ${symbol}:`, error);
    }

    // No mock data — return empty if API fails
    return [];
  }

  /**
   * Get live IV for a symbol. Uses last fetched option chain ATM IV.
   * Falls back to default IV.
   */
  private async getIV(symbol: string): Promise<number> {
    const cached = ivCache[symbol];
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL.iv) {
      return cached.data;
    }

    try {
      const dhanClient = getDhanStream();
      // Try fetching ATM IV from option chain
      const chainData = await dhanClient.getOptionChain(symbol, 'current');
      if (chainData?.data?.oc) {
        const spot = await dhanClient.getSpotPrice(symbol);
        const strikes = Object.keys(chainData.data.oc).map(Number).sort((a, b) => a - b);
        // Find ATM strike
        const atm = strikes.reduce((closest, s) =>
          Math.abs(s - spot) < Math.abs(closest - spot) ? s : closest
        , strikes[0]);
        const atmData = chainData.data.oc[atm.toFixed(6)] || chainData.data.oc[String(atm)];
        if (atmData?.ce?.implied_volatility) {
          const iv = atmData.ce.implied_volatility / 100; // decimal
          ivCache[symbol] = { data: iv, timestamp: Date.now() };
          return iv;
        }
      }
    } catch { /* fallback */ }

    return (DEFAULT_IV[symbol] || 13) / 100;
  }

  /**
   * Get spot price
   */
  private async getSpotPrice(symbol: string): Promise<number> {
    try {
      const dhanClient = getDhanStream();
      return await dhanClient.getSpotPrice(symbol);
    } catch (error) {
      console.error(`Error fetching spot price for ${symbol}:`, error);
      return 0;
    }
  }

  /**
   * Get complete range data for a single index.
   */
  async getIndexRangeData(symbol: string): Promise<IndexRangeData> {
    const [spotPrice, dailyCandles, iv] = await Promise.all([
      this.getSpotPrice(symbol),
      this.getDailyCandles(symbol, 60), // 60 daily candles → enough for monthly ATR
      this.getIV(symbol),
    ]);

    // ── Daily ATR + EM ──
    const dailyATR = buildATRData(dailyCandles);
    const dailyEM = calculateExpectedMove(spotPrice, iv, 1);

    // ── Weekly ATR + EM ──
    const weeklyCandles = aggregateWeekly(dailyCandles);
    const weeklyATR = buildATRData(weeklyCandles);
    const weeklyEM = calculateExpectedMove(spotPrice, iv, 5);

    // ── Monthly ATR + EM ──
    const monthlyCandles = aggregateMonthly(dailyCandles);
    const monthlyATR = buildATRData(monthlyCandles);
    const monthlyEM = calculateExpectedMove(spotPrice, iv, 21);

    return {
      symbol,
      spotPrice: Number(spotPrice.toFixed(2)),
      daily: { atr: dailyATR, expectedMove: dailyEM },
      weekly: { atr: weeklyATR, expectedMove: weeklyEM },
      monthly: { atr: monthlyATR, expectedMove: monthlyEM },
      lastUpdated: Date.now(),
    };
  }

  /**
   * Get range data for all supported indices — staggered to avoid 429 rate limits.
   */
  async getAllIndicesRangeData(): Promise<AllIndicesRangeData> {
    const indicesData: IndexRangeData[] = [];
    for (const symbol of SUPPORTED_INDICES) {
      indicesData.push(await this.getIndexRangeData(symbol));
    }

    return {
      indices: indicesData,
      timestamp: Date.now(),
    };
  }

}

export const marketRangeService = new MarketRangeService();
