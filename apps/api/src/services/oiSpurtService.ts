/**
 * OI Spurt Detection Service
 * Tracks Open Interest changes and detects spurts (≥10% increase)
 */

export interface OIData {
  strike: number;
  optionType: 'CE' | 'PE';
  openInterest: number;
  timestamp: number;
}

export interface OISpurtAlert {
  active: boolean;
  strike: string; // e.g., "18300CE"
  percent: number;
  timestamp: number;
  optionType: 'CE' | 'PE';
}

interface OIHistory {
  [key: string]: { // key: "strike_type" e.g., "18300_CE"
    current: number;
    previous: number;
    timestamp: number;
  };
}

// Symbol-specific OI history
interface SymbolOIHistory {
  [symbol: string]: OIHistory;
}

class OISpurtService {
  private symbolOIHistory: SymbolOIHistory = {};
  private spurtThreshold: number = 10.0; // 10% threshold
  private lastSpurt: { [symbol: string]: OISpurtAlert | null } = {};

  /**
   * Generate a key for OI tracking
   */
  private getKey(strike: number, optionType: 'CE' | 'PE'): string {
    return `${strike}_${optionType}`;
  }

  /**
   * Get or initialize OI history for a symbol
   */
  private getSymbolHistory(symbol: string): OIHistory {
    if (!this.symbolOIHistory[symbol]) {
      this.symbolOIHistory[symbol] = {};
    }
    return this.symbolOIHistory[symbol];
  }

  /**
   * Update OI data and detect spurts for a specific symbol
   */
  updateOI(symbol: string, data: OIData[]): OISpurtAlert | null {
    const oiHistory = this.getSymbolHistory(symbol);
    let maxSpurt: OISpurtAlert | null = null;
    let maxSpurtPercent = this.spurtThreshold;

    data.forEach(item => {
      const key = this.getKey(item.strike, item.optionType);
      const history = oiHistory[key];

      if (history && history.current > 0) {
        // Calculate percent change
        const percentChange = ((item.openInterest - history.current) / history.current) * 100;

        // Check if it's a spurt (≥ threshold)
        if (percentChange >= this.spurtThreshold) {
          // Track the maximum spurt
          if (percentChange > maxSpurtPercent) {
            maxSpurtPercent = percentChange;
            maxSpurt = {
              active: true,
              strike: `${item.strike}${item.optionType}`,
              percent: Number(percentChange.toFixed(1)),
              timestamp: item.timestamp,
              optionType: item.optionType,
            };
          }
        }

        // Update history: previous = current, current = new
        oiHistory[key] = {
          current: item.openInterest,
          previous: history.current,
          timestamp: item.timestamp,
        };
      } else {
        // First time seeing this strike
        oiHistory[key] = {
          current: item.openInterest,
          previous: item.openInterest,
          timestamp: item.timestamp,
        };
      }
    });

    if (maxSpurt) {
      this.lastSpurt[symbol] = maxSpurt;
    }

    return maxSpurt;
  }

  /**
   * Get the last detected spurt for a symbol
   */
  getLastSpurt(symbol: string): OISpurtAlert | null {
    return this.lastSpurt[symbol] || null;
  }

  /**
   * Set the spurt threshold (default 10%)
   */
  setThreshold(threshold: number): void {
    this.spurtThreshold = Math.max(0, threshold);
  }

  /**
   * Clear OI history (useful for switching instruments)
   */
  clearHistory(symbol?: string): void {
    if (symbol) {
      this.symbolOIHistory[symbol] = {};
      this.lastSpurt[symbol] = null;
    } else {
      this.symbolOIHistory = {};
      this.lastSpurt = {};
    }
  }

  /**
   * Get current OI history (for debugging)
   */
  getHistory(symbol: string): OIHistory {
    return { ...this.getSymbolHistory(symbol) };
  }

  /**
   * Calculate OI spurt percentage for a specific strike
   */
  getSpurtPercent(symbol: string, strike: number, optionType: 'CE' | 'PE'): number | null {
    const oiHistory = this.getSymbolHistory(symbol);
    const key = this.getKey(strike, optionType);
    const history = oiHistory[key];

    if (!history || history.previous === 0) {
      return null;
    }

    const percentChange = ((history.current - history.previous) / history.previous) * 100;
    return Number(percentChange.toFixed(1));
  }
}

export const oiSpurtService = new OISpurtService();
