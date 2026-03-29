import { OptionChain, OptionChainRow } from '@option-dashboard/shared';

/**
 * Option Snapshot Service
 * 
 * Stores option chain snapshots IN MEMORY to enable
 * interval-based Volume, OI Change, and OI Change% calculations.
 * 
 * NO Redis dependency — always works reliably.
 */

export interface OptionSnapshot {
  strike: number;
  optionType: 'CE' | 'PE';
  oi: number;
  volume: number;
  ltp: number;
  timestamp: number;
}

export interface SnapshotData {
  symbol: string;
  expiry: string;
  spotPrice: number;
  timestamp: number;
  strikes: OptionSnapshot[];
}

class OptionSnapshotService {
  // In-memory snapshot store: key -> array of snapshots (newest first)
  private snapshotStore: Map<string, SnapshotData[]> = new Map();
  private readonly MAX_SNAPSHOTS = 500;

  /**
   * Store a snapshot of current option chain data (in-memory)
   */
  async storeSnapshot(
    symbol: string,
    expiry: string,
    optionChainData: any,
    spotPrice: number
  ): Promise<void> {
    try {
      const key = this.getSnapshotKey(symbol, expiry);
      const timestamp = Date.now();

      const strikes: OptionSnapshot[] = [];
      
      if (optionChainData.rows || optionChainData.strikes) {
        const rows = optionChainData.rows || optionChainData.strikes;
        
        rows.forEach((row: any) => {
          if (row.ce) {
            strikes.push({
              strike: row.strike, optionType: 'CE',
              oi: row.ce.oi || 0, volume: row.ce.volume || 0,
              ltp: row.ce.ltp || 0, timestamp,
            });
          }
          if (row.pe) {
            strikes.push({
              strike: row.strike, optionType: 'PE',
              oi: row.pe.oi || 0, volume: row.pe.volume || 0,
              ltp: row.pe.ltp || 0, timestamp,
            });
          }
        });
      }

      const snapshot: SnapshotData = { symbol, expiry, spotPrice, timestamp, strikes };

      // Store in memory (newest first)
      if (!this.snapshotStore.has(key)) {
        this.snapshotStore.set(key, []);
      }
      const snapshots = this.snapshotStore.get(key)!;
      snapshots.unshift(snapshot);

      // Trim old snapshots
      if (snapshots.length > this.MAX_SNAPSHOTS) {
        snapshots.length = this.MAX_SNAPSHOTS;
      }

      console.log(`📸 Stored in-memory snapshot for ${symbol} (total: ${snapshots.length})`);
    } catch (error) {
      console.error('Error storing snapshot:', error);
    }
  }

  /**
   * Get snapshot from N minutes ago (from in-memory store)
   */
  getSnapshotFromMinutesAgo(
    symbol: string,
    expiry: string,
    minutesAgo: number
  ): SnapshotData | null {
    try {
      const key = this.getSnapshotKey(symbol, expiry);
      const snapshots = this.snapshotStore.get(key);
      
      if (!snapshots || snapshots.length === 0) {
        return null;
      }

      const targetTime = Date.now() - (minutesAgo * 60 * 1000);
      let closestSnapshot: SnapshotData | null = null;
      let minTimeDiff = Infinity;

      for (const snapshot of snapshots) {
        const timeDiff = Math.abs(snapshot.timestamp - targetTime);
        if (timeDiff < minTimeDiff) {
          minTimeDiff = timeDiff;
          closestSnapshot = snapshot;
        }
      }

      // Only use if snapshot is within 2x the interval range AND is actually old enough
      // (prevents using a freshly-stored snapshot as "5 minutes ago" when there's only 1 snapshot)
      const minimumAgeMs = minutesAgo * 60 * 1000 * 0.5; // snapshot must be at least half the interval old
      const snapshotAgeMs = closestSnapshot ? Date.now() - closestSnapshot.timestamp : 0;
      if (closestSnapshot && minTimeDiff < minutesAgo * 60 * 1000 * 2 && snapshotAgeMs >= minimumAgeMs) {
        return closestSnapshot;
      }

      return null;
    } catch (error) {
      console.error('Error getting snapshot:', error);
      return null;
    }
  }

  /**
   * Calculate interval-based changes for option chain data
   */
  async calculateIntervalChanges(
    symbol: string,
    expiry: string,
    currentData: any,
    interval: string
  ): Promise<any> {
    try {
      // Parse interval (3m, 5m, 15m, 30m, 60m, 1D)
      const minutesAgo = this.parseInterval(interval);
      
      // Get historical snapshot
      const historicalSnapshot = await this.getSnapshotFromMinutesAgo(
        symbol,
        expiry,
        minutesAgo
      );

      if (!historicalSnapshot) {
        console.warn(`⚠️ No historical snapshot found for ${symbol} ${expiry} ${interval} ago — using full-day (1D) values`);
        
        // No historical snapshot: return the full-day values as-is (Volume, OI Chg, OI Chg%)
        // Proportional estimation was producing near-zero values for short intervals
        // and incorrectly scaled OI Chg% (percentages can't be time-scaled).
        // Showing full-day data is more useful than estimated near-zeros.
        return {
          ...currentData,
          intervalUsed: interval,
          estimated: true,
        };
      }

      console.log(`📊 Calculating ${interval} interval changes using snapshot from ${new Date(historicalSnapshot.timestamp).toLocaleTimeString()}`);

      // Create a map of historical data for quick lookup
      const historicalMap = new Map<string, OptionSnapshot>();
      historicalSnapshot.strikes.forEach(strike => {
        const key = `${strike.strike}_${strike.optionType}`;
        historicalMap.set(key, strike);
      });

      // Update current data with interval-based calculations
      const updatedRows = (currentData.rows || currentData.strikes || []).map((row: any) => {
        const strike = row.strike;
        
        // Calculate CE interval changes
        let ceUpdated = { ...row.ce };
        if (row.ce) {
          const historicalCE = historicalMap.get(`${strike}_CE`);
          if (historicalCE) {
            ceUpdated.volume = Math.max(0, row.ce.volume - historicalCE.volume);
            ceUpdated.oiChg = row.ce.oi - historicalCE.oi;
            const oiChgPercent = historicalCE.oi > 0 
              ? (ceUpdated.oiChg / historicalCE.oi) * 100 
              : 0;
            ceUpdated.oiChgPercent = oiChgPercent;
          }
        }

        // Calculate PE interval changes
        let peUpdated = { ...row.pe };
        if (row.pe) {
          const historicalPE = historicalMap.get(`${strike}_PE`);
          if (historicalPE) {
            peUpdated.volume = Math.max(0, row.pe.volume - historicalPE.volume);
            peUpdated.oiChg = row.pe.oi - historicalPE.oi;
            const oiChgPercent = historicalPE.oi > 0 
              ? (peUpdated.oiChg / historicalPE.oi) * 100 
              : 0;
            peUpdated.oiChgPercent = oiChgPercent;
          }
        }

        return {
          ...row,
          ce: ceUpdated,
          pe: peUpdated,
        };
      });

      return {
        ...currentData,
        rows: updatedRows,
        strikes: updatedRows,
        intervalUsed: interval,
        snapshotAge: Date.now() - historicalSnapshot.timestamp,
      };
    } catch (error) {
      console.error('Error calculating interval changes:', error);
      return currentData;
    }
  }

  /**
   * Parse interval string to minutes
   */
  private parseInterval(interval: string): number {
    const upper = interval.toUpperCase();
    
    if (upper === '1D') return 1440; // Full trading day
    if (upper === 'AUTO') return 5; // Default to 5m for auto mode
    if (upper === '1H') return 60;
    if (upper === '4H') return 240;
    
    // Extract number and unit (1m, 5m, 15m, 60m, etc.)
    const match = interval.match(/(\d+)(m|h)?/i);
    if (match) {
      const num = parseInt(match[1]);
      const unit = (match[2] || 'm').toLowerCase();
      return unit === 'h' ? num * 60 : num;
    }
    
    // Default to 5 minutes
    return 5;
  }

  /**
   * Get storage key for snapshots
   */
  private getSnapshotKey(symbol: string, expiry: string): string {
    return `${symbol}:${expiry}`;
  }

  /**
   * Get the latest snapshot from the current trading session.
   * Returns null if no snapshot exists or if the latest is from before
   * today's 9:15 IST session start.
   */
  getLatestSnapshot(symbol: string, expiry: string): SnapshotData | null {
    const key = this.getSnapshotKey(symbol, expiry);
    const snapshots = this.snapshotStore.get(key);
    if (!snapshots || snapshots.length === 0) return null;

    const latest = snapshots[0]; // newest first

    // Session reset: ignore snapshots from before 9:15 IST today
    const now = new Date();
    const sessionStart = new Date(now);
    // 9:15 IST = 3:45 UTC
    sessionStart.setUTCHours(3, 45, 0, 0);
    if (now.getTime() < sessionStart.getTime()) {
      // Before today's session → use yesterday's start
      sessionStart.setDate(sessionStart.getDate() - 1);
    }
    if (latest.timestamp < sessionStart.getTime()) return null;

    return latest;
  }

  /**
   * Build a Map<strike, PrevStrikeData> from the latest snapshot.
   * Used by Module 2 (OI Shift) and Module 3 (Volume Shift).
   */
  getStrikePrevData(
    symbol: string,
    expiry: string,
  ): Map<number, { ceOi: number; peOi: number; ceVol: number; peVol: number }> {
    const result = new Map<number, { ceOi: number; peOi: number; ceVol: number; peVol: number }>();
    const snapshot = this.getLatestSnapshot(symbol, expiry);
    if (!snapshot) return result;

    // Group by strike
    const byStrike = new Map<number, { ceOi: number; peOi: number; ceVol: number; peVol: number }>();
    for (const s of snapshot.strikes) {
      const entry = byStrike.get(s.strike) || { ceOi: 0, peOi: 0, ceVol: 0, peVol: 0 };
      if (s.optionType === 'CE') {
        entry.ceOi = s.oi;
        entry.ceVol = s.volume;
      } else {
        entry.peOi = s.oi;
        entry.peVol = s.volume;
      }
      byStrike.set(s.strike, entry);
    }

    return byStrike;
  }

  /**
   * Compute rolling average volumes over the last N snapshot cycles.
   * Returns Map<"strike_CE"|"strike_PE", avgVolume>.
   * Used by Module 3 (Volume Shift Detection).
   */
  getRollingAverageVolumes(
    symbol: string,
    expiry: string,
    cycles: number = 5,
  ): Map<string, number> {
    const key = this.getSnapshotKey(symbol, expiry);
    const snapshots = this.snapshotStore.get(key);
    const result = new Map<string, number>();

    if (!snapshots || snapshots.length === 0) return result;

    const n = Math.min(cycles, snapshots.length);
    const volSums = new Map<string, { total: number; count: number }>();

    for (let i = 0; i < n; i++) {
      for (const s of snapshots[i].strikes) {
        const k = `${s.strike}_${s.optionType}`;
        const entry = volSums.get(k) || { total: 0, count: 0 };
        entry.total += s.volume;
        entry.count++;
        volSums.set(k, entry);
      }
    }

    for (const [k, v] of volSums) {
      result.set(k, v.count > 0 ? v.total / v.count : 0);
    }

    return result;
  }

  /**
   * Get snapshot count for debugging
   */
  getSnapshotCount(symbol: string, expiry: string): number {
    const key = this.getSnapshotKey(symbol, expiry);
    return this.snapshotStore.get(key)?.length || 0;
  }

  /**
   * Clean up old snapshots
   */
  async cleanupOldSnapshots(): Promise<void> {
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
    for (const [key, snapshots] of this.snapshotStore.entries()) {
      const filtered = snapshots.filter(s => s.timestamp > cutoffTime);
      if (filtered.length === 0) {
        this.snapshotStore.delete(key);
      } else {
        this.snapshotStore.set(key, filtered);
      }
    }
    console.log('🧹 Snapshot cleanup complete');
  }
}

// Singleton instance
export const optionSnapshotService = new OptionSnapshotService();
