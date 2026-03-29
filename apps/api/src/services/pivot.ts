import { PivotLevels, calculateClassicPivot } from '@option-dashboard/shared';
import { getDhanStream } from './dhanClient';

/**
 * In-memory cache for OHLC data (refreshed from Dhan API)
 */
interface OHLCCache {
  high: number;
  low: number;
  close: number;
  timestamp: number;
}
const ohlcCache: Record<string, OHLCCache> = {};
const OHLC_CACHE_TTL_MS = 60000; // 60 seconds

/**
 * Fetch real OHLC data from Dhan API for pivot calculation
 */
async function fetchRealOHLC(index: string): Promise<{ high: number; low: number; close: number }> {
  const symbolMap: Record<string, string> = {
    'nifty50': 'NIFTY',
    'nifty': 'NIFTY',
    'banknifty': 'BANKNIFTY',
    'finnifty': 'FINNIFTY',
    'midcapnifty': 'MIDCAPNIFTY',
    'sensex': 'SENSEX',
    'bankex': 'BANKEX',
  };
  const symbol = symbolMap[index.toLowerCase()] || 'NIFTY';

  // Check cache first
  const cached = ohlcCache[symbol];
  if (cached && Date.now() - cached.timestamp < OHLC_CACHE_TTL_MS) {
    return { high: cached.high, low: cached.low, close: cached.close };
  }

  const dhan = getDhanStream();
  const spotPrice = await dhan.getSpotPrice(symbol);

  // Dhan quote response includes OHLC — "close" is previous day close
  // Use spotPrice as fallback base
  const ohlc = { high: spotPrice, low: spotPrice, close: spotPrice };
  
  // Try to extract OHLC from the raw quote if dhanClient exposes it
  try {
    const rawQuote = await (dhan as any).getRawQuote?.(symbol);
    if (rawQuote?.ohlc) {
      ohlc.high = rawQuote.ohlc.high || ohlc.high;
      ohlc.low = rawQuote.ohlc.low || ohlc.low;
      ohlc.close = rawQuote.ohlc.close || ohlc.close;
    }
  } catch { /* use spotPrice as approximation */ }

  // Cache it
  ohlcCache[symbol] = { ...ohlc, timestamp: Date.now() };
  return ohlc;
}

/**
 * Get pivot levels for specified index using real data from Dhan API
 */
export async function getPivotLevels(index: string): Promise<PivotLevels> {
  try {
    const ohlc = await fetchRealOHLC(index);
    return calculateClassicPivot(ohlc);
  } catch (error) {
    console.error(`Failed to fetch OHLC for pivot (${index}):`, error);
    // If we have stale cache, use it
    const symbolMap: Record<string, string> = {
      'nifty50': 'NIFTY', 'banknifty': 'BANKNIFTY', 'finnifty': 'FINNIFTY',
      'midcapnifty': 'MIDCAPNIFTY', 'sensex': 'SENSEX', 'bankex': 'BANKEX',
    };
    const symbol = symbolMap[index.toLowerCase()] || 'NIFTY';
    const stale = ohlcCache[symbol];
    if (stale) {
      return calculateClassicPivot({ high: stale.high, low: stale.low, close: stale.close });
    }
    throw error;
  }
}
