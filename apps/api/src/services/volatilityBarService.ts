/**
 * Volatility Pressure Bar Service
 * Calculates CE_Score and PE_Score based on VWAP, Built-up, Premium, Volume
 * for ATM ± 3 strikes (7 strikes total)
 * 
 * Formula:
 * - CE_Score = Sum of (VWAP_Score + BuiltUp_Score + Premium_Score + Volume_Score) for ATM±3 CE
 * - PE_Score = Sum of (VWAP_Score + BuiltUp_Score + Premium_Score + Volume_Score) for ATM±3 PE
 * - Bar Position = CE_Score - PE_Score (negative = bearish, positive = bullish)
 */

import { getOptionChain } from './optionChain';

export interface VolatilityPressureData {
  ceScore: number;
  peScore: number;
  netScore: number;          // ceScore - peScore
  pressurePercent: number;   // -100 to +100 scale
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  breakdown: {
    ce: StrikeScore[];
    pe: StrikeScore[];
  };
  timestamp: number;
}

interface StrikeScore {
  strike: number;
  vwapScore: number;
  builtUpScore: number;
  premiumScore: number;
  volumeScore: number;
  totalScore: number;
}

interface OptionStrikeData {
  strike: number;
  ltp: number;
  ltpChg: number;
  oi: number;
  oiChg: number;
  volume: number;
  iv: number;
  builtUp: string;
}

// Score weights for each component
const WEIGHTS = {
  VWAP: 25,       // VWAP contribution (25%)
  BUILDUP: 30,    // Built-up pattern (30%)
  PREMIUM: 25,    // Premium change (25%)
  VOLUME: 20,     // Volume activity (20%)
};

// Built-up pattern scores
const BUILDUP_SCORES: Record<string, { ce: number; pe: number }> = {
  'Call OI Increase': { ce: 10, pe: -5 },
  'buy back': { ce: 5, pe: -3 },
  'Put OI Increase': { ce: -10, pe: 5 },
  'profit booking': { ce: -5, pe: 3 },
  'Long Build Up': { ce: 10, pe: -5 },
  'Short Covering': { ce: 5, pe: -3 },
  'Short Cover': { ce: 5, pe: -3 },
  'Long Unwinding': { ce: -5, pe: 3 },
  'Long Unwind': { ce: -5, pe: 3 },
  'Short Build Up': { ce: -10, pe: 5 },
  'Short Built Up': { ce: -10, pe: 5 },
};

class VolatilityBarService {
  /**
   * Calculate VWAP score based on LTP position relative to typical VWAP
   * Higher LTP relative to average = higher buying pressure
   */
  private calculateVWAPScore(data: OptionStrikeData, allStrikes: OptionStrikeData[]): number {
    if (allStrikes.length === 0) return 0;
    
    // Calculate average LTP for normalization
    const avgLTP = allStrikes.reduce((sum, s) => sum + s.ltp, 0) / allStrikes.length;
    if (avgLTP === 0) return 0;
    
    // VWAP proxy: LTP weighted by volume
    const vwapProxy = (data.ltp * data.volume) / Math.max(data.volume, 1);
    const normalizedScore = ((data.ltp - avgLTP) / avgLTP) * WEIGHTS.VWAP;
    
    return Math.max(-10, Math.min(10, normalizedScore));
  }

  /**
   * Calculate Built-up score based on OI and LTP change patterns
   */
  private calculateBuiltUpScore(data: OptionStrikeData, optionType: 'CE' | 'PE'): number {
    const builtUp = data.builtUp || '';
    const scores = BUILDUP_SCORES[builtUp];
    
    if (scores) {
      return optionType === 'CE' ? scores.ce : scores.pe;
    }
    
    // Fallback: Calculate from raw data
    // OI increasing + LTP increasing = Long Build Up (bullish for CE)
    // OI increasing + LTP decreasing = Short Build Up (bearish for CE)
    // OI decreasing + LTP increasing = Short Covering (bullish)
    // OI decreasing + LTP decreasing = Long Unwinding (bearish)
    
    const oiChange = data.oiChg;
    const ltpChange = data.ltpChg;
    
    if (oiChange > 0 && ltpChange > 0) {
      return optionType === 'CE' ? 8 : -4; // Long Build Up
    } else if (oiChange > 0 && ltpChange < 0) {
      return optionType === 'CE' ? -8 : 4; // Short Build Up
    } else if (oiChange < 0 && ltpChange > 0) {
      return optionType === 'CE' ? 4 : -2; // Short Covering
    } else if (oiChange < 0 && ltpChange < 0) {
      return optionType === 'CE' ? -4 : 2; // Long Unwinding
    }
    
    return 0;
  }

  /**
   * Calculate Premium score based on LTP change
   */
  private calculatePremiumScore(data: OptionStrikeData, allStrikes: OptionStrikeData[]): number {
    if (data.ltp === 0) return 0;
    
    const changePercent = (data.ltpChg / data.ltp) * 100;
    
    // Normalize to -10 to +10 scale
    // 5% change = max score
    const normalizedScore = (changePercent / 5) * (WEIGHTS.PREMIUM / 2.5);
    
    return Math.max(-10, Math.min(10, normalizedScore));
  }

  /**
   * Calculate Volume score based on relative volume
   */
  private calculateVolumeScore(data: OptionStrikeData, allStrikes: OptionStrikeData[]): number {
    if (allStrikes.length === 0) return 0;
    
    const avgVolume = allStrikes.reduce((sum, s) => sum + s.volume, 0) / allStrikes.length;
    if (avgVolume === 0) return 0;
    
    // Higher than average volume = positive score
    const volumeRatio = data.volume / avgVolume;
    const normalizedScore = (volumeRatio - 1) * (WEIGHTS.VOLUME / 2);
    
    return Math.max(-10, Math.min(10, normalizedScore));
  }

  /**
   * Calculate total score for a single strike
   */
  private calculateStrikeScore(
    data: OptionStrikeData, 
    allStrikes: OptionStrikeData[],
    optionType: 'CE' | 'PE'
  ): StrikeScore {
    const vwapScore = this.calculateVWAPScore(data, allStrikes);
    const builtUpScore = this.calculateBuiltUpScore(data, optionType);
    const premiumScore = this.calculatePremiumScore(data, allStrikes);
    const volumeScore = this.calculateVolumeScore(data, allStrikes);
    
    return {
      strike: data.strike,
      vwapScore: Number(vwapScore.toFixed(2)),
      builtUpScore: Number(builtUpScore.toFixed(2)),
      premiumScore: Number(premiumScore.toFixed(2)),
      volumeScore: Number(volumeScore.toFixed(2)),
      totalScore: Number((vwapScore + builtUpScore + premiumScore + volumeScore).toFixed(2)),
    };
  }

  /**
   * Extract option data from chain row
   */
  private extractOptionData(row: any, optionType: 'CE' | 'PE'): OptionStrikeData {
    const data = optionType === 'CE' ? row.ce : row.pe;
    return {
      strike: row.strike,
      ltp: data?.ltp || 0,
      ltpChg: data?.chg || data?.ltpChg || 0,
      oi: data?.oi || 0,
      oiChg: data?.oiChg || 0,
      volume: data?.volume || 0,
      iv: data?.iv || 0,
      builtUp: data?.builtUp || '',
    };
  }

  /**
   * Calculate Volatility Pressure Data for a symbol
   */
  async calculateVolatilityPressure(
    symbol: string,
    expiry?: string
  ): Promise<VolatilityPressureData> {
    try {
      // Fetch option chain
      const optionChain = await getOptionChain(symbol, expiry);
      
      if (!optionChain || !optionChain.rows || optionChain.rows.length === 0) {
        return this.getEmptyPressureData();
      }
      
      const rows = optionChain.rows;
      const atmStrike = optionChain.atmStrike || optionChain.spotPrice || 0;
      
      // Find ATM index
      let atmIndex = rows.findIndex((row: any) => row.isATM || row.isSpotStrike);
      if (atmIndex === -1) {
        // Find closest strike to spot
        atmIndex = rows.findIndex((row: any) => 
          Math.abs(row.strike - atmStrike) < 100
        );
      }
      if (atmIndex === -1) atmIndex = Math.floor(rows.length / 2);
      
      // Get ATM ± 3 strikes (7 strikes total)
      const startIdx = Math.max(0, atmIndex - 3);
      const endIdx = Math.min(rows.length, atmIndex + 4);
      const relevantRows = rows.slice(startIdx, endIdx);
      
      // Extract CE and PE data
      const ceData = relevantRows.map((row: any) => this.extractOptionData(row, 'CE'));
      const peData = relevantRows.map((row: any) => this.extractOptionData(row, 'PE'));
      
      // Calculate scores for each strike
      const ceScores = ceData.map((data: OptionStrikeData) => 
        this.calculateStrikeScore(data, ceData, 'CE')
      );
      const peScores = peData.map((data: OptionStrikeData) => 
        this.calculateStrikeScore(data, peData, 'PE')
      );
      
      // Sum up total scores
      const totalCEScore = ceScores.reduce((sum: number, s: StrikeScore) => sum + s.totalScore, 0);
      const totalPEScore = peScores.reduce((sum: number, s: StrikeScore) => sum + s.totalScore, 0);
      const netScore = totalCEScore - totalPEScore;
      
      // Convert to -100 to +100 scale
      // Max theoretical score per side = 7 strikes * 40 max points = 280
      const maxPossibleScore = 280;
      const pressurePercent = Math.max(-100, Math.min(100, 
        (netScore / maxPossibleScore) * 100
      ));
      
      // Determine signal
      let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
      if (pressurePercent > 20) {
        signal = 'BULLISH';
      } else if (pressurePercent < -20) {
        signal = 'BEARISH';
      } else {
        signal = 'NEUTRAL';
      }
      
      return {
        ceScore: Number(totalCEScore.toFixed(2)),
        peScore: Number(totalPEScore.toFixed(2)),
        netScore: Number(netScore.toFixed(2)),
        pressurePercent: Number(pressurePercent.toFixed(1)),
        signal,
        breakdown: {
          ce: ceScores,
          pe: peScores,
        },
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Error calculating volatility pressure:', error);
      return this.getEmptyPressureData();
    }
  }

  /**
   * Get empty pressure data for error cases
   */
  private getEmptyPressureData(): VolatilityPressureData {
    return {
      ceScore: 0,
      peScore: 0,
      netScore: 0,
      pressurePercent: 0,
      signal: 'NEUTRAL',
      breakdown: { ce: [], pe: [] },
      timestamp: Date.now(),
    };
  }
}

export const volatilityBarService = new VolatilityBarService();
