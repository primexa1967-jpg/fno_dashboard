/**
 * Camarilla Breakout Engine Service
 * Calculates Camarilla Pivot Points (H1-H4, L1-L4) from weekly OHLC
 * Generates trading signals: BUY CALL, BUY PUT, or NO TRADE
 * 
 * Camarilla Formula (using H, L, C from previous period):
 * - H4 = Close + (High - Low) * 1.5000 / 2
 * - H3 = Close + (High - Low) * 1.2500 / 4
 * - H2 = Close + (High - Low) * 1.1666 / 6
 * - H1 = Close + (High - Low) * 1.0833 / 12
 * - L1 = Close - (High - Low) * 1.0833 / 12
 * - L2 = Close - (High - Low) * 1.1666 / 6
 * - L3 = Close - (High - Low) * 1.2500 / 4
 * - L4 = Close - (High - Low) * 1.5000 / 2
 * 
 * Trading Signals:
 * - Price > H4: BUY CALL (Breakout)
 * - Price < L4: BUY PUT (Breakdown)
 * - H3 < Price < H4: Wait for Breakout / Reversal zone
 * - L4 < Price < L3: Wait for Breakdown / Reversal zone
 * - L3 < Price < H3: NO TRADE (Range bound)
 */

import { getDhanStream } from './dhanClient';

export interface CamarillaLevels {
  h4: number;  // Resistance 4 - Breakout level
  h3: number;  // Resistance 3 - Strong resistance
  h2: number;  // Resistance 2
  h1: number;  // Resistance 1
  pivot: number; // Central pivot (optional, for reference)
  l1: number;  // Support 1
  l2: number;  // Support 2
  l3: number;  // Support 3 - Strong support
  l4: number;  // Support 4 - Breakdown level
}

export interface CamarillaSignal {
  signal: 'BUY CALL' | 'BUY PUT' | 'NO TRADE' | 'WAIT BREAKOUT' | 'WAIT BREAKDOWN';
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  reason: string;
  targetLevel: number | null;
  stopLossLevel: number | null;
}

export interface CamarillaData {
  symbol: string;
  spotPrice: number;
  levels: CamarillaLevels;
  signal: CamarillaSignal;
  pricePosition: string;
  weeklyOHLC: {
    open: number;
    high: number;
    low: number;
    close: number;
  };
  timestamp: number;
}

// Camarilla multipliers
const CAMARILLA_MULTIPLIERS = {
  H4: 1.5000 / 2,    // 0.75
  H3: 1.2500 / 4,    // 0.3125
  H2: 1.1666 / 6,    // 0.1944
  H1: 1.0833 / 12,   // 0.0903
  L1: 1.0833 / 12,   // 0.0903
  L2: 1.1666 / 6,    // 0.1944
  L3: 1.2500 / 4,    // 0.3125
  L4: 1.5000 / 2,    // 0.75
};

// Cache for weekly OHLC to prevent excessive API calls
interface OHLCCache {
  [symbol: string]: {
    data: { open: number; high: number; low: number; close: number };
    timestamp: number;
  };
}

const weeklyOHLCCache: OHLCCache = {};
const CACHE_TTL = 60 * 60 * 1000; // 1 hour cache

class CamarillaEngineService {
  /**
   * Calculate Camarilla levels from OHLC data
   */
  private calculateLevels(high: number, low: number, close: number): CamarillaLevels {
    const range = high - low;
    
    return {
      h4: Number((close + range * CAMARILLA_MULTIPLIERS.H4).toFixed(2)),
      h3: Number((close + range * CAMARILLA_MULTIPLIERS.H3).toFixed(2)),
      h2: Number((close + range * CAMARILLA_MULTIPLIERS.H2).toFixed(2)),
      h1: Number((close + range * CAMARILLA_MULTIPLIERS.H1).toFixed(2)),
      pivot: Number(((high + low + close) / 3).toFixed(2)),
      l1: Number((close - range * CAMARILLA_MULTIPLIERS.L1).toFixed(2)),
      l2: Number((close - range * CAMARILLA_MULTIPLIERS.L2).toFixed(2)),
      l3: Number((close - range * CAMARILLA_MULTIPLIERS.L3).toFixed(2)),
      l4: Number((close - range * CAMARILLA_MULTIPLIERS.L4).toFixed(2)),
    };
  }

  /**
   * Generate trading signal based on spot price and Camarilla levels
   */
  private generateSignal(spotPrice: number, levels: CamarillaLevels): CamarillaSignal {
    const { h4, h3, l3, l4 } = levels;

    // Breakout above H4 - Strong BUY CALL
    if (spotPrice > h4) {
      return {
        signal: 'BUY CALL',
        strength: 'STRONG',
        reason: 'Price broke above H4 resistance - Bullish breakout confirmed',
        targetLevel: h4 + (h4 - h3), // Project next level
        stopLossLevel: h3, // Stop below H3
      };
    }

    // Breakdown below L4 - Strong BUY PUT
    if (spotPrice < l4) {
      return {
        signal: 'BUY PUT',
        strength: 'STRONG',
        reason: 'Price broke below L4 support - Bearish breakdown confirmed',
        targetLevel: l4 - (l3 - l4), // Project next level
        stopLossLevel: l3, // Stop above L3
      };
    }

    // Between H3 and H4 - Wait for breakout or reversal
    if (spotPrice > h3 && spotPrice <= h4) {
      return {
        signal: 'WAIT BREAKOUT',
        strength: 'MODERATE',
        reason: 'Price approaching H4 resistance - Wait for breakout confirmation',
        targetLevel: h4,
        stopLossLevel: h3,
      };
    }

    // Between L4 and L3 - Wait for breakdown or reversal
    if (spotPrice < l3 && spotPrice >= l4) {
      return {
        signal: 'WAIT BREAKDOWN',
        strength: 'MODERATE',
        reason: 'Price approaching L4 support - Wait for breakdown confirmation',
        targetLevel: l4,
        stopLossLevel: l3,
      };
    }

    // Between L3 and H3 - Range bound, no trade
    return {
      signal: 'NO TRADE',
      strength: 'WEAK',
      reason: 'Price trading within L3-H3 range - Wait for directional move',
      targetLevel: null,
      stopLossLevel: null,
    };
  }

  /**
   * Get price position description
   */
  private getPricePosition(spotPrice: number, levels: CamarillaLevels): string {
    const { h4, h3, h2, h1, l1, l2, l3, l4 } = levels;

    if (spotPrice > h4) return 'Above H4 (Breakout Zone)';
    if (spotPrice > h3) return 'Between H3-H4 (Resistance Zone)';
    if (spotPrice > h2) return 'Between H2-H3';
    if (spotPrice > h1) return 'Between H1-H2';
    if (spotPrice > l1) return 'Between L1-H1 (Neutral)';
    if (spotPrice > l2) return 'Between L2-L1';
    if (spotPrice > l3) return 'Between L3-L2';
    if (spotPrice > l4) return 'Between L4-L3 (Support Zone)';
    return 'Below L4 (Breakdown Zone)';
  }

  /**
   * Get weekly OHLC data for a symbol
   */
  private async getWeeklyOHLC(symbol: string): Promise<{ open: number; high: number; low: number; close: number }> {
    const cached = weeklyOHLCCache[symbol];
    const now = Date.now();

    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      return cached.data;
    }

    try {
      const dhanClient = getDhanStream();
      // Get last 10 daily candles to calculate weekly OHLC
      const candles = await dhanClient.getHistoricalCandles(symbol, '1D', 10);

      if (candles && candles.length >= 5) {
        // Get last 5 trading days (previous week)
        const weekCandles = candles.slice(-6, -1); // Exclude today

        const ohlc = {
          open: weekCandles[0]?.open || 0,
          high: Math.max(...weekCandles.map(c => c.high)),
          low: Math.min(...weekCandles.map(c => c.low)),
          close: weekCandles[weekCandles.length - 1]?.close || 0,
        };

        weeklyOHLCCache[symbol] = { data: ohlc, timestamp: now };
        return ohlc;
      }
    } catch (error) {
      console.error(`Error fetching weekly OHLC for ${symbol}:`, error);
    }

    // No fallback — throw if API fails so caller can handle it
    throw new Error(`Failed to fetch weekly OHLC for ${symbol}`);
  }

  /**
   * Get spot price for symbol
   */
  private async getSpotPrice(symbol: string): Promise<number> {
    try {
      const dhanClient = getDhanStream();
      return await dhanClient.getSpotPrice(symbol);
    } catch (error) {
      console.error(`Error fetching spot price for ${symbol}:`, error);
      throw new Error(`Failed to fetch spot price for ${symbol}`);
    }
  }

  /**
   * Get complete Camarilla data for a symbol
   */
  async getCamarillaData(symbol: string): Promise<CamarillaData> {
    const [spotPrice, weeklyOHLC] = await Promise.all([
      this.getSpotPrice(symbol),
      this.getWeeklyOHLC(symbol),
    ]);

    const levels = this.calculateLevels(weeklyOHLC.high, weeklyOHLC.low, weeklyOHLC.close);
    const signal = this.generateSignal(spotPrice, levels);
    const pricePosition = this.getPricePosition(spotPrice, levels);

    return {
      symbol,
      spotPrice,
      levels,
      signal,
      pricePosition,
      weeklyOHLC,
      timestamp: Date.now(),
    };
  }

  /**
   * Get Camarilla data for all supported indices
   */
  async getAllIndicesCamarillaData(): Promise<CamarillaData[]> {
    const indices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCAPNIFTY', 'SENSEX', 'BANKEX'];
    
    const results = await Promise.all(
      indices.map(symbol => this.getCamarillaData(symbol))
    );

    return results;
  }

}

export const camarillaEngineService = new CamarillaEngineService();
