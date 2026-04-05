/**
 * Confidence Engine Service (index options — NIFTY, BANKNIFTY, etc.)
 * Architecture: OI + gamma → structure; flow → confirmation; price/VWAP/IV → entry timing only.
 * 1. Structure  (PCR + OI cluster + gamma concentration near ATM)
 * 2. Flow       (Net OI Δ% — directional confirmation)
 * 3. Momentum   (VWAP + IV + volume — timing, not primary direction)
 * 4. TF Score   (0.50·S + 0.35·F + 0.15·M)
 * 5. Final Bias (gated: no strong bias on momentum alone; flow must confirm structure)
 */

import { getDhanStream } from './dhanClient';
import { marketRangeService } from './marketRangeService';
import { scannerEngine } from './scannerEngine';
import { buildConfidenceEngineOutput, type ConfidenceEngineOutput } from './confidenceEngine';

// ─────────────────────────────────────────────────────────────────────────────
// Public interfaces
// ─────────────────────────────────────────────────────────────────────────────

export type FinalBias = 'Bullish' | 'Mild_Bullish' | 'Neutral' | 'Mild_Bearish' | 'Bearish';
export type AlignmentType = 'Strong' | 'Mixed';

export interface SignalIndicators {
  // Raw market data
  spotPrice: number;
  vwap: number;
  pcr: number;
  oiChangeCE: number;   // CE OI change % (for Net_Flow)
  oiChangePE: number;   // PE OI change % (for Net_Flow)
  ivChange: number;     // % change in avg IV
  ivChange15m: number;  // % change in IV over 15-min window
  volumeChange: number; // % vs 20-period average
  volumeChange15m: number;
  priceChange: number;  // price direction for IV_Score

  // Cluster data
  callCluster: number;
  putCluster: number;

  // Scored components
  structurePCR: -1 | 0 | 1;
  structureCluster: -1 | 0 | 1;
  /** Net gamma positioning near ATM (OI·|gamma| CE vs PE) */
  structureGamma: -1 | 0 | 1;
  structureScore: number;   // clamped -2 to +2
  flowScore: number;        // -2 to +2
  momentumScore: number;    // -2 to +2 (may be float due to ×1.5)
  vwapDeviation: number;    // percentage
  vwapScore: -1 | 0 | 1;
  ivScore: -1 | 0 | 1;
  netFlow: number;

  // Composite
  tfScore: number;
  finalScore: number;
  finalBias: FinalBias;

  // Multi-timeframe bias
  bias3m: FinalBias;
  bias5m: FinalBias;
  bias15m: FinalBias;
  trend3m: 'UP' | 'DOWN' | 'NEUTRAL';
  trend5m: 'UP' | 'DOWN' | 'NEUTRAL';
  trend15m: 'UP' | 'DOWN' | 'NEUTRAL';

  timestamp: string;
}

export interface SignalResult {
  // Legacy fields kept for backward-compat with frontend chips
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  /** Final adjusted confidence % (0–100) after Range → Confidence pipeline */
  confidence: number;
  alignment: AlignmentType;
  indicators: SignalIndicators;
  reasons: string[];
  /** Range-first confidence engine output (omitted when chain cache missing) */
  confidenceEngine?: ConfidenceEngineOutput;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal snapshot storage (for OI/IV/Vol change calculations)
// ─────────────────────────────────────────────────────────────────────────────
interface SnapshotData {
  totalCEOI: number;
  totalPEOI: number;
  totalCEVolume: number;
  totalPEVolume: number;
  avgCEIV: number;
  avgPEIV: number;
  spotPrice: number;
  ceOIChangePct: number;  // per-snapshot OI chg %
  peOIChangePct: number;
  finalBias: FinalBias;   // bias at snapshot time (for alignment)
  timestamp: number;
}

const snapshotHistory: { [symbol: string]: SnapshotData[] } = {};
const MAX_SNAPSHOTS = 60; // ~5 hours at 5-min intervals

// Volume rolling window (20-period avg)
const volumeHistory: { [symbol: string]: number[] } = {};

// ─────────────────────────────────────────────────────────────────────────────
// Option chain cache
// ─────────────────────────────────────────────────────────────────────────────
interface CachedOptionChain {
  data: any;
  spotPrice: number;
  timestamp: number;
  expiry?: string;
}

const optionChainCache: { [key: string]: CachedOptionChain } = {};
const CACHE_TTL_MS = 20000;

// ─────────────────────────────────────────────────────────────────────────────
// Strike step per symbol (for cluster calculation)
// ─────────────────────────────────────────────────────────────────────────────
const STRIKE_STEPS: Record<string, number> = {
  NIFTY:       50,
  BANKNIFTY:  100,
  FINNIFTY:    50,
  MIDCAPNIFTY: 25,
  SENSEX:     100,
  BANKEX:     100,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: clamp
// ─────────────────────────────────────────────────────────────────────────────
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ─────────────────────────────────────────────────────────────────────────────
// CONDITION 1: Structure Score
// ─────────────────────────────────────────────────────────────────────────────
function calcStructurePCR(pcr: number): -1 | 0 | 1 {
  if (pcr < 0.7)  return -1;
  if (pcr > 1.1)  return  1;
  return 0;
}

function calcStructureCluster(callCluster: number, putCluster: number): -1 | 0 | 1 {
  if (callCluster > putCluster * 1.2) return -1;
  if (putCluster  > callCluster * 1.2) return  1;
  return 0;
}

function calcStructureScore(pcrScore: number, clusterScore: number, gammaScore: number): number {
  const raw = pcrScore + clusterScore + gammaScore;
  return clamp(raw, -2, 2);
}

/** Gamma structure: net OI·|gamma| imbalance near ATM (puts vs calls) — index wall / pin logic */
function calcGammaStructure(rows: any[], spotPrice: number, symbol: string): -1 | 0 | 1 {
  const step = STRIKE_STEPS[symbol.toUpperCase()] || 50;
  const atm = Math.round(spotPrice / step) * step;
  let gCe = 0;
  let gPe = 0;
  rows.forEach((row: any) => {
    const strike = row.strike || 0;
    if (Math.abs(strike - atm) > step * 3) return;
    const ce = row.ce || {};
    const pe = row.pe || {};
    gCe += Math.abs((ce.gamma || 0) * (ce.oi || 0));
    gPe += Math.abs((pe.gamma || 0) * (pe.oi || 0));
  });
  const t = gCe + gPe;
  if (t < 1e3) return 0;
  const ratio = gPe / (gCe + 1e-6);
  if (ratio > 1.12) return 1;
  if (ratio < 0.88) return -1;
  return 0;
}

// Cluster = sum of CE/PE OI within ATM ± 3 strikes
function calcClusters(
  rows: any[],
  spotPrice: number,
  symbol: string
): { callCluster: number; putCluster: number; atmStrike: number } {
  const step = STRIKE_STEPS[symbol.toUpperCase()] || 50;
  const atmStrike = Math.round(spotPrice / step) * step;

  let callCluster = 0;
  let putCluster  = 0;

  rows.forEach((row: any) => {
    const strike = row.strike || 0;
    if (Math.abs(strike - atmStrike) <= step * 3) {
      callCluster += row.ce?.oi || 0;
      putCluster  += row.pe?.oi || 0;
    }
  });

  return { callCluster, putCluster, atmStrike };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONDITION 2: Flow Score
// ─────────────────────────────────────────────────────────────────────────────
function calcFlowScore(netFlow: number): number {
  if (netFlow > 3)              return  2;
  if (netFlow > 1)              return  1;
  if (netFlow >= -1)            return  0;
  if (netFlow >= -3)            return -1;
  return -2;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONDITION 3: Momentum Score
// ─────────────────────────────────────────────────────────────────────────────
function calcVWAPScore(vwapDeviation: number): -1 | 0 | 1 {
  if (vwapDeviation >  0.2) return  1;
  if (vwapDeviation < -0.2) return -1;
  return 0;
}

function calcIVScore(priceChange: number, ivChange: number): -1 | 0 | 1 {
  if (ivChange <= 0)  return 0;
  if (priceChange > 0) return  1;   // price up + IV up → bullish surge
  return -1;                          // price down + IV up → fear
}

function calcMomentumScore(
  vwapScore: number,
  ivScore: number,
  volumeChangePct: number
): number {
  const base = vwapScore + ivScore;
  const raw  = volumeChangePct > 8 ? base * 1.5 : base;
  return clamp(raw, -2, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONDITION 4: TF Score
// ─────────────────────────────────────────────────────────────────────────────
function calcTFScore(s: number, f: number, m: number): number {
  return 0.5 * s + 0.35 * f + 0.15 * m;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONDITION 5: Final Bias
// ─────────────────────────────────────────────────────────────────────────────
function calcFinalBias(finalScore: number): FinalBias {
  if (finalScore >  1.5) return 'Bullish';
  if (finalScore >  0.5) return 'Mild_Bullish';
  if (finalScore >= -0.5) return 'Neutral';
  if (finalScore >= -1.5) return 'Mild_Bearish';
  return 'Bearish';
}

/**
 * Bias from layers: structure (OI+gamma+PCR) drives direction; flow must not contradict;
 * momentum only nudges — cannot create Bullish/Bearish without structural + flow support.
 */
function calcFinalBiasGated(
  structureScore: number,
  flowScore: number,
  momentumScore: number,
  tfComposite: number
): FinalBias {
  const sDir = structureScore > 0.35 ? 1 : structureScore < -0.35 ? -1 : 0;
  const fDir = flowScore >= 1 ? 1 : flowScore <= -1 ? -1 : flowScore > 0 ? 1 : flowScore < 0 ? -1 : 0;

  if (sDir !== 0 && fDir !== 0 && sDir !== fDir) {
    return calcFinalBias(0.15 * momentumScore);
  }

  if (Math.abs(structureScore) < 0.25 && Math.abs(flowScore) < 1) {
    return calcFinalBias(0.2 * momentumScore);
  }

  return calcFinalBias(tfComposite);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONDITION 6: Confidence (clamped 20-85)
// ─────────────────────────────────────────────────────────────────────────────
function calcConfidence(
  finalScore: number,
  ivChange15m: number,
  volumeChange15m: number,
  momentumScore15m: number,
  bias3m: FinalBias,
  bias5m: FinalBias,
  bias15m: FinalBias
): number {
  let c = Math.abs(finalScore) * 30;

  // IV surge bonus
  if (ivChange15m > 0.5)                    c += 10;
  else if (ivChange15m > 0.2)               c +=  5;

  // Timeframe alignment bonus
  if (bias3m === bias5m && bias5m === bias15m) {
    c += 10;
  } else if (bias5m === bias15m && bias3m !== bias5m) {
    c +=  5;
  }

  // Timing: small bonus only when structure and flow already agree (not raw momentum)
  if (Math.abs(momentumScore15m) >= 1.5 && Math.abs(finalScore) >= 0.4) c += 3;

  // Weak-signal penalty
  if (ivChange15m < 0 && volumeChange15m < 5) c -= 10;

  return clamp(Math.round(c), 20, 85);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONDITION 7: Alignment
// ─────────────────────────────────────────────────────────────────────────────
function calcAlignment(
  bias3m: FinalBias,
  bias5m: FinalBias,
  bias15m: FinalBias
): AlignmentType {
  return bias3m === bias5m && bias5m === bias15m ? 'Strong' : 'Mixed';
}

// ─────────────────────────────────────────────────────────────────────────────
// Trend from candles helper
// ─────────────────────────────────────────────────────────────────────────────
function trendFromCandles(candles: any[]): 'UP' | 'DOWN' | 'NEUTRAL' {
  if (!candles || candles.length < 10) return 'NEUTRAL';
  const recent  = candles.slice(-10);
  const older   = candles.slice(-20, -10);
  const recentAvg = recent.reduce((s: number, c: any) => s + c.close, 0) / recent.length;
  const olderAvg  = older.length
    ? older.reduce((s: number, c: any) => s + c.close, 0) / older.length
    : recentAvg;
  const bullish = recent.filter((c: any) => c.close > c.open).length;
  const bearish = recent.filter((c: any) => c.close < c.open).length;
  if (recentAvg > olderAvg && bullish > bearish) return 'UP';
  if (recentAvg < olderAvg && bearish > bullish) return 'DOWN';
  return 'NEUTRAL';
}

// ─────────────────────────────────────────────────────────────────────────────
// Service class
// ─────────────────────────────────────────────────────────────────────────────
class SignalEngineService {

  async calculateSignal(symbol: string, expiry?: string): Promise<SignalResult> {
    try {
      const upperSymbol = symbol.toUpperCase();
      const cacheKey    = `${upperSymbol}_${expiry || 'current'}`;
      const now         = Date.now();
      const cached      = optionChainCache[cacheKey];

      if (!cached || (now - cached.timestamp) >= CACHE_TTL_MS) {
        console.log(`⚠️ No valid cache for signal (${upperSymbol}) – waiting for option chain`);
        return this.getDefaultSignal(upperSymbol);
      }

      const optionChainData = cached.data;
      const spotPrice       = cached.spotPrice;
      const rows            = optionChainData.rows || optionChainData.strikes || [];

      // ── Aggregate current OI / IV / Volume ──────────────────────────────
      let totalCEOI = 0, totalPEOI = 0;
      let totalCEVol = 0, totalPEVol = 0;
      let totalCEIV = 0, totalPEIV = 0;
      let ceCount = 0, peCount = 0;

      rows.forEach((row: any) => {
        const ce = row.ce || {};
        const pe = row.pe || {};
        totalCEOI  += ce.oi  || 0;
        totalPEOI  += pe.oi  || 0;
        totalCEVol += ce.volume || 0;
        totalPEVol += pe.volume || 0;
        if (ce.iv) { totalCEIV += ce.iv; ceCount++; }
        if (pe.iv) { totalPEIV += pe.iv; peCount++; }
      });

      const avgCEIV = ceCount > 0 ? totalCEIV / ceCount : 0;
      const avgPEIV = peCount > 0 ? totalPEIV / peCount : 0;
      const avgIV   = (avgCEIV + avgPEIV) / 2;
      const pcr     = totalCEOI > 0 ? totalPEOI / totalCEOI : 1;

      // ── Historical deltas ────────────────────────────────────────────────
      const history     = snapshotHistory[upperSymbol] || [];
      const prevSnap    = history.length >= 2 ? history[history.length - 2] : null;
      const snap15m     = this.getSnapshotMinutesAgo(upperSymbol, 15);

      let oiChangeCE   = 0, oiChangePE = 0;
      let ivChange     = 0, ivChange15m = 0;
      let volumeChange = 0, volumeChange15m = 0;
      let priceChange  = 0;

      if (prevSnap) {
        if (prevSnap.totalCEOI > 0)
          oiChangeCE = ((totalCEOI - prevSnap.totalCEOI) / prevSnap.totalCEOI) * 100;
        if (prevSnap.totalPEOI > 0)
          oiChangePE = ((totalPEOI - prevSnap.totalPEOI) / prevSnap.totalPEOI) * 100;
        const prevVol = prevSnap.totalCEVolume + prevSnap.totalPEVolume;
        const curVol  = totalCEVol + totalPEVol;
        if (prevVol > 0) volumeChange = ((curVol - prevVol) / prevVol) * 100;
        const prevIV = (prevSnap.avgCEIV + prevSnap.avgPEIV) / 2;
        if (prevIV  > 0) ivChange = ((avgIV - prevIV) / prevIV) * 100;
        priceChange = spotPrice - prevSnap.spotPrice;
      }

      if (snap15m) {
        const prevIV15 = (snap15m.avgCEIV + snap15m.avgPEIV) / 2;
        if (prevIV15 > 0) ivChange15m = ((avgIV - prevIV15) / prevIV15) * 100;
        const prevVol15 = snap15m.totalCEVolume + snap15m.totalPEVolume;
        const curVol    = totalCEVol + totalPEVol;
        if (prevVol15 > 0) volumeChange15m = ((curVol - prevVol15) / prevVol15) * 100;
      }

      // 20-period volume average for Volume_Change
      if (!volumeHistory[upperSymbol]) volumeHistory[upperSymbol] = [];
      volumeHistory[upperSymbol].push(totalCEVol + totalPEVol);
      if (volumeHistory[upperSymbol].length > 20) volumeHistory[upperSymbol].shift();
      const volAvg20 = volumeHistory[upperSymbol].length >= 2
        ? volumeHistory[upperSymbol].slice(0, -1).reduce((a, b) => a + b, 0) /
          (volumeHistory[upperSymbol].length - 1)
        : 0;
      let volumeChangePct = volAvg20 > 0
        ? ((totalCEVol + totalPEVol - volAvg20) / volAvg20) * 100
        : volumeChange;

      // Rolling poll average can spike ±100% early in the session; prefer snap-to-snap vs prior snapshot when unstable.
      if (prevSnap) {
        const prevVolTick = prevSnap.totalCEVolume + prevSnap.totalPEVolume;
        const curVolTick = totalCEVol + totalPEVol;
        const histLen = volumeHistory[upperSymbol].length;
        const snapPct =
          prevVolTick > 0 ? ((curVolTick - prevVolTick) / prevVolTick) * 100 : 0;
        if (
          histLen < 8 ||
          (Number.isFinite(volumeChangePct) && Math.abs(volumeChangePct) > 80)
        ) {
          if (Number.isFinite(snapPct)) {
            volumeChangePct = snapPct;
          }
        }
      }

      // ── CONDITION 1: Structure (OI + gamma + PCR + clusters) ─────────────
      const { callCluster, putCluster } = calcClusters(rows, spotPrice, upperSymbol);
      const structurePCR     = calcStructurePCR(pcr);
      const structureCluster = calcStructureCluster(callCluster, putCluster);
      const structureGamma   = calcGammaStructure(rows, spotPrice, upperSymbol);
      const structureScore   = calcStructureScore(structurePCR, structureCluster, structureGamma);

      // ── CONDITION 2: Flow ────────────────────────────────────────────────
      const netFlow   = oiChangePE - oiChangeCE;
      const flowScore = calcFlowScore(netFlow);

      // ── CONDITION 3: Momentum ────────────────────────────────────────────
      // VWAP proxy: use Dhan OHLC (day High/Low/Close) → typical price
      let vwap = spotPrice; // fallback
      try {
        const dhanClient = getDhanStream();
        const ohlcData = await dhanClient.getOHLCData(upperSymbol);
        if (ohlcData && ohlcData.high > 0 && ohlcData.low > 0) {
          // Typical Price = (High + Low + Close) / 3
          vwap = (ohlcData.high + ohlcData.low + (ohlcData.close || spotPrice)) / 3;
        }
      } catch { /* keep spotPrice fallback */ }
      const vwapDeviation = vwap > 0 ? ((spotPrice - vwap) / vwap) * 100 : 0;
      const vwapScore     = calcVWAPScore(vwapDeviation);
      const ivScore       = calcIVScore(priceChange, ivChange);
      const momentumScore = calcMomentumScore(vwapScore, ivScore, volumeChangePct);

      // ── CONDITION 4: TF Score ────────────────────────────────────────────
      const tfScore    = calcTFScore(structureScore, flowScore, momentumScore);
      const finalScore = tfScore;

      // ── CONDITION 5: Final Bias (gated — not price/momentum alone) ───────
      const finalBias = calcFinalBiasGated(structureScore, flowScore, momentumScore, finalScore);

      // ── Multi-timeframe trends from candles ──────────────────────────────
      let trend3m: 'UP' | 'DOWN' | 'NEUTRAL'  = 'NEUTRAL';
      let trend5m: 'UP' | 'DOWN' | 'NEUTRAL'  = 'NEUTRAL';
      let trend15m: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';

      try {
        const dhanClient = getDhanStream();
        const [c3, c5, c15] = await Promise.all([
          dhanClient.getHistoricalCandles(upperSymbol, '3',  20),
          dhanClient.getHistoricalCandles(upperSymbol, '5',  20),
          dhanClient.getHistoricalCandles(upperSymbol, '15', 20),
        ]);
        if (c3.length  >= 10) trend3m  = trendFromCandles(c3);
        if (c5.length  >= 10) trend5m  = trendFromCandles(c5);
        if (c15.length >= 10) trend15m = trendFromCandles(c15);
      } catch { /* keep defaults */ }

      // Convert trend → bias for alignment
      const trendToBias = (t: 'UP' | 'DOWN' | 'NEUTRAL'): FinalBias => {
        if (t === 'UP')   return finalScore > 0 ? finalBias : 'Mild_Bullish';
        if (t === 'DOWN') return finalScore < 0 ? finalBias : 'Mild_Bearish';
        return 'Neutral';
      };

      // Use per-timeframe OI snapshot biases if available, otherwise use trend
      const bias3m  = this.getBiasFromSnapshot(upperSymbol, 3)  || trendToBias(trend3m);
      const bias5m  = this.getBiasFromSnapshot(upperSymbol, 5)  || trendToBias(trend5m);
      const bias15m = this.getBiasFromSnapshot(upperSymbol, 15) || trendToBias(trend15m);

      // ── Momentum Score for 15m window (for confidence) ───────────────────
      const vwapDev15m       = vwapDeviation; // same spot, approximation
      const vwapScore15m     = calcVWAPScore(vwapDev15m);
      const ivScore15m       = calcIVScore(priceChange, ivChange15m);
      const momentumScore15m = calcMomentumScore(vwapScore15m, ivScore15m, volumeChangePct);

      // ── CONDITION 6: Legacy confidence (fallback if range engine unavailable)
      const legacyConfidence = calcConfidence(
        finalScore, ivChange15m, volumeChange15m,
        momentumScore15m, bias3m, bias5m, bias15m
      );

      // ── CONDITION 7: Alignment ───────────────────────────────────────────
      const alignment = calcAlignment(bias3m, bias5m, bias15m);

      // ── Range → Confidence engine (live range + scanner + IV) ────────────
      let confidenceEngineOut: ConfidenceEngineOutput | undefined;
      let confidence = legacyConfidence;
      try {
        const dhanClient = getDhanStream();
        const [rangeData, ivPack, scanRes] = await Promise.all([
          marketRangeService.getIndexRangeData(upperSymbol),
          dhanClient.getIVData(upperSymbol).catch(() => null),
          scannerEngine.scanIndex(upperSymbol).catch(() => null),
        ]);
        const indiaVIX =
          ivPack && typeof ivPack.iv === 'number' && ivPack.iv > 0
            ? Number(ivPack.iv)
            : avgIV > 0
              ? Number(avgIV)
              : 0;
        const scannerHasSetup = !!(scanRes && scanRes.signal && scanRes.signal !== 'NO TRADE');
        const totalOiChgAbsPct =
          (Math.abs(oiChangeCE) + Math.abs(oiChangePE)) / 2;

        confidenceEngineOut = buildConfidenceEngineOutput({
          symbol: upperSymbol,
          spotPrice,
          rangeData,
          structurePCR,
          structureCluster,
          structureGamma,
          oiChangeCE,
          oiChangePE,
          vwapScore,
          volumeChangePct,
          trend3m,
          trend5m,
          trend15m,
          indiaVIX: indiaVIX > 0 ? indiaVIX : 15,
          totalOiChgAbsPct,
          scannerHasSetup,
          oiHistoryReady: !!prevSnap,
        });
        confidence = clamp(confidenceEngineOut.confidenceAdjusted, 0, 100);
      } catch (ceErr) {
        console.warn('Confidence engine v2 skipped:', ceErr);
      }

      // ── Build reasons ────────────────────────────────────────────────────
      const reasons: string[] = [];
      if (structurePCR ===  1) reasons.push(`PCR ${pcr.toFixed(2)} > 1.1 → Bullish structure`);
      if (structurePCR === -1) reasons.push(`PCR ${pcr.toFixed(2)} < 0.7 → Bearish structure`);
      if (structureCluster ===  1) reasons.push(`Put cluster (${Math.round(putCluster/1000)}K) > Call → Support`);
      if (structureCluster === -1) reasons.push(`Call cluster (${Math.round(callCluster/1000)}K) > Put → Resistance`);
      if (structureGamma === 1) reasons.push('ATM gamma: put-side dominance (OI·gamma) → structural support');
      if (structureGamma === -1) reasons.push('ATM gamma: call-side dominance (OI·gamma) → structural resistance');
      if (flowScore >=  1) reasons.push(`Net Flow +${netFlow.toFixed(1)}% → Bullish flow`);
      if (flowScore <= -1) reasons.push(`Net Flow ${netFlow.toFixed(1)}% → Bearish flow`);
      if (vwapScore ===  1) reasons.push(`Spot above VWAP (+${vwapDeviation.toFixed(2)}%)`);
      if (vwapScore === -1) reasons.push(`Spot below VWAP (${vwapDeviation.toFixed(2)}%)`);
      if (ivScore ===  1) reasons.push('IV rising with price → Bullish surge');
      if (ivScore === -1) reasons.push('IV rising with price falling → Fear');
      if (volumeChangePct > 8) reasons.push(`Volume surge ${volumeChangePct.toFixed(0)}% → Momentum amplified`);
      if (alignment === 'Strong') reasons.push(`All timeframes aligned: ${finalBias}`);
      reasons.push(`Confidence: ${confidence}% | Alignment: ${alignment}`);
      if (confidenceEngineOut) {
        reasons.push(
          `Range: ${confidenceEngineOut.rangeState.replace(/_/g, ' ')} | Reliability: ${confidenceEngineOut.rangeReliability} | Dir: ${confidenceEngineOut.direction}`,
        );
        confidenceEngineOut.adjustmentNotes.forEach(n => reasons.push(n));
      }

      // Legacy signal field (for backward compat)
      const signal: 'BUY' | 'SELL' | 'NEUTRAL' =
        finalBias === 'Bullish' || finalBias === 'Mild_Bullish' ? 'BUY' :
        finalBias === 'Bearish' || finalBias === 'Mild_Bearish' ? 'SELL' : 'NEUTRAL';

      // ── Store snapshot ────────────────────────────────────────────────────
      this.storeSnapshot(upperSymbol, {
        totalCEOI, totalPEOI, totalCEVolume: totalCEVol, totalPEVolume: totalPEVol,
        avgCEIV, avgPEIV,
        spotPrice,
        ceOIChangePct: oiChangeCE, peOIChangePct: oiChangePE,
        finalBias,
        timestamp: now,
      });

      const indicators: SignalIndicators = {
        spotPrice,
        vwap,
        pcr:              parseFloat(pcr.toFixed(2)),
        oiChangeCE:       parseFloat(oiChangeCE.toFixed(2)),
        oiChangePE:       parseFloat(oiChangePE.toFixed(2)),
        ivChange:         parseFloat(ivChange.toFixed(2)),
        ivChange15m:      parseFloat(ivChange15m.toFixed(2)),
        volumeChange:     parseFloat(volumeChange.toFixed(2)),
        volumeChange15m:  parseFloat(volumeChange15m.toFixed(2)),
        priceChange:      parseFloat(priceChange.toFixed(2)),
        callCluster,
        putCluster,
        structurePCR,
        structureCluster,
        structureGamma,
        structureScore:   parseFloat(structureScore.toFixed(2)),
        flowScore:        parseFloat(flowScore.toFixed(2)),
        momentumScore:    parseFloat(momentumScore.toFixed(2)),
        vwapDeviation:    parseFloat(vwapDeviation.toFixed(3)),
        vwapScore,
        ivScore,
        netFlow:          parseFloat(netFlow.toFixed(2)),
        tfScore:          parseFloat(tfScore.toFixed(3)),
        finalScore:       parseFloat(finalScore.toFixed(3)),
        finalBias,
        bias3m,
        bias5m,
        bias15m,
        trend3m,
        trend5m,
        trend15m,
        timestamp: new Date().toISOString(),
      };

      return { signal, confidence, alignment, indicators, reasons, confidenceEngine: confidenceEngineOut };

    } catch (error) {
      console.error('Error calculating signal:', error);
      return this.getDefaultSignal(symbol);
    }
  }

  // ── Snapshot helpers ───────────────────────────────────────────────────────

  private storeSnapshot(symbol: string, snap: SnapshotData): void {
    if (!snapshotHistory[symbol]) snapshotHistory[symbol] = [];
    snapshotHistory[symbol].push(snap);
    if (snapshotHistory[symbol].length > MAX_SNAPSHOTS) {
      snapshotHistory[symbol].shift();
    }
  }

  private getSnapshotMinutesAgo(symbol: string, minutes: number): SnapshotData | null {
    const history = snapshotHistory[symbol];
    if (!history || history.length === 0) return null;
    const target = Date.now() - minutes * 60 * 1000;
    let best: SnapshotData | null = null;
    let bestDiff = Infinity;
    for (const snap of history) {
      const diff = Math.abs(snap.timestamp - target);
      if (diff < bestDiff) { bestDiff = diff; best = snap; }
    }
    // Only valid if within 2× the window
    return best && bestDiff < minutes * 60 * 1000 * 2 ? best : null;
  }

  private getBiasFromSnapshot(symbol: string, minutesAgo: number): FinalBias | null {
    const snap = this.getSnapshotMinutesAgo(symbol, minutesAgo);
    return snap ? snap.finalBias : null;
  }

  // ── Cache update (called from option chain route) ──────────────────────────

  updateCache(symbol: string, expiry: string | undefined, optionChainData: any, spotPrice: number): void {
    const cacheKey = `${symbol.toUpperCase()}_${expiry || 'current'}`;
    optionChainCache[cacheKey] = { data: optionChainData, spotPrice, timestamp: Date.now(), expiry };
    console.log(`📦 Signal engine cache updated for ${symbol}`);
  }

  getCachedOptionChain(symbol: string, expiry?: string): CachedOptionChain | null {
    const cacheKey = `${symbol.toUpperCase()}_${expiry || 'current'}`;
    const cached   = optionChainCache[cacheKey];
    if (!cached) return null;
    const age = Date.now() - cached.timestamp;
    if (age > CACHE_TTL_MS) return null;
    return cached;
  }

  // ── Default / fallback ─────────────────────────────────────────────────────

  private getDefaultSignal(symbol: string): SignalResult {
    const defaultIndicators: SignalIndicators = {
      spotPrice: 0, vwap: 0, pcr: 1,
      oiChangeCE: 0, oiChangePE: 0,
      ivChange: 0, ivChange15m: 0,
      volumeChange: 0, volumeChange15m: 0,
      priceChange: 0,
      callCluster: 0, putCluster: 0,
      structurePCR: 0, structureCluster: 0, structureGamma: 0,
      structureScore: 0, flowScore: 0, momentumScore: 0,
      vwapDeviation: 0, vwapScore: 0, ivScore: 0,
      netFlow: 0, tfScore: 0, finalScore: 0,
      finalBias: 'Neutral',
      bias3m: 'Neutral', bias5m: 'Neutral', bias15m: 'Neutral',
      trend3m: 'NEUTRAL', trend5m: 'NEUTRAL', trend15m: 'NEUTRAL',
      timestamp: new Date().toISOString(),
    };
    return {
      signal: 'NEUTRAL',
      confidence: 20,
      alignment: 'Mixed',
      indicators: defaultIndicators,
      reasons: ['Awaiting option chain data…'],
      confidenceEngine: undefined,
    };
  }
}

export const signalEngineService = new SignalEngineService();

