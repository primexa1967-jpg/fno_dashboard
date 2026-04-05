/**
 * Confidence Engine v2 — Range → Confidence → Bias (educational analytics).
 * Uses live range (ATR + EM), option-chain-derived scores, and overlap reliability.
 * No synthetic prices; range/OHLC from marketRangeService + Dhan path used elsewhere.
 */

import type { IndexRangeData } from './marketRangeService';
import { calculateOverlap } from './engines/rangeEngine';

export type RangeState =
  | 'DEEP_RANGE'
  | 'INNER_RANGE'
  | 'NEAR_EDGE'
  | 'BREAKOUT_ZONE'
  | 'EXTREME';

export type RangeReliability = 'HIGH' | 'MEDIUM' | 'LOW';
export type ConfidenceDirection = 'Bullish' | 'Bearish' | 'Neutral';

export type MarketProfileLabel = 'Stable' | 'Volatile' | 'Weak OI' | 'Stable OI';
export type ConfidenceTier =
  | 'Low'
  | 'Weak'
  | 'Medium'
  | 'High'
  | 'Very High';

export interface ComponentScores {
  structure: -1 | 0 | 1;
  oiFlow: -1 | 0 | 1;
  gamma: -1 | 0 | 1;
  momentum: -1 | 0 | 1;
  alignment: -1 | 0 | 1;
}

export interface ConfidenceEngineOutput {
  /** Pipeline order marker */
  pipelineOrder: 'Range → Confidence → Bias → Decision';

  rangeState: RangeState;
  rangeReliability: RangeReliability;
  overlapPercent: number;

  componentScores: ComponentScores;
  weightsUsed: Record<keyof ComponentScores, number>;

  /** 0–100 from weighted discrete components; neutral sum → 50 (not forced to 0). */
  confidenceRaw: number;
  /** After conflict + reliability, before deep-range “no trade” zero (same as adjusted when not DEEP_RANGE). */
  confidenceBeforeDeepRange: number;
  confidenceAdjusted: number;
  confidenceTier: ConfidenceTier;
  direction: ConfidenceDirection;

  tradeZone: 'NO_TRADE_ZONE' | 'CAUTION' | 'ACTIVE_CONTEXT';
  adjustmentNotes: string[];

  /** Trigger framing (scanner linkage optional — filled in signalEngine) */
  triggerStatus: 'VALID' | 'STRONG' | 'NONE';
  triggerType: 'Breakout' | 'Retest' | 'None';
  triggerLevelHint: string;
  invalidationHint: string;
  targetZoneHint: string;
  extensionZoneHint: string;
  momentumStatus: 'Strong' | 'Weakening' | 'Reversal';

  marketProfile: MarketProfileLabel;
  scannerSetupStrength: 'HIGH' | 'MEDIUM' | 'LOW' | 'NO SETUP';
}

const WEIGHTS: Record<string, Record<keyof ComponentScores, number>> = {
  NIFTY:       { structure: 0.2, oiFlow: 0.3, gamma: 0.15, momentum: 0.2, alignment: 0.15 },
  BANKNIFTY:   { structure: 0.2, oiFlow: 0.3, gamma: 0.15, momentum: 0.2, alignment: 0.15 },
  FINNIFTY:    { structure: 0.25, oiFlow: 0.22, gamma: 0.15, momentum: 0.23, alignment: 0.15 },
  MIDCAPNIFTY: { structure: 0.2, oiFlow: 0.3, gamma: 0.1, momentum: 0.25, alignment: 0.15 },
  SENSEX:      { structure: 0.2, oiFlow: 0.3, gamma: 0.1, momentum: 0.25, alignment: 0.15 },
  BANKEX:      { structure: 0.2, oiFlow: 0.3, gamma: 0.1, momentum: 0.25, alignment: 0.15 },
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function combinedDailyBounds(rd: IndexRangeData): { upper: number; lower: number; width: number } {
  const tf = rd.daily;
  const upper = Math.max(tf.atr.highRange, tf.expectedMove.upperBound);
  const lower = Math.min(tf.atr.lowRange, tf.expectedMove.lowerBound);
  return { upper, lower, width: upper - lower };
}

export function classifyRangeState(spot: number, upper: number, lower: number, width: number): RangeState {
  if (width <= 0 || !Number.isFinite(spot)) return 'INNER_RANGE';
  if (spot > upper) {
    return spot > upper + width * 0.5 ? 'EXTREME' : 'BREAKOUT_ZONE';
  }
  if (spot < lower) {
    return spot < lower - width * 0.5 ? 'EXTREME' : 'BREAKOUT_ZONE';
  }
  const t = (spot - lower) / width;
  if (t <= 0.2 || t >= 0.8) return 'NEAR_EDGE';
  if (t > 0.35 && t < 0.65) return 'DEEP_RANGE';
  return 'INNER_RANGE';
}

function overlapReliability(overlap: number): RangeReliability {
  if (overlap >= 70) return 'HIGH';
  if (overlap >= 50) return 'MEDIUM';
  return 'LOW';
}

/** Single -1/0/1 structure from PCR + cluster + gamma (majority / strong tilt). */
function structureDiscrete(
  structurePCR: -1 | 0 | 1,
  structureCluster: -1 | 0 | 1,
  structureGamma: -1 | 0 | 1,
): -1 | 0 | 1 {
  const s = structurePCR + structureCluster + structureGamma;
  if (s >= 2) return 1;
  if (s <= -2) return -1;
  if (s === 0) return 0;
  return s > 0 ? 1 : -1;
}

/** Put OI ↑ + Call OI ↓ → +1; Call OI ↑ + Put OI ↓ → -1; else 0 */
function oiFlowDiscrete(oiChangeCE: number, oiChangePE: number): -1 | 0 | 1 {
  const thr = 0.35;
  const putUp = oiChangePE > thr;
  const callDown = oiChangeCE < -thr;
  const callUp = oiChangeCE > thr;
  const putDown = oiChangePE < -thr;
  if (putUp && callDown) return 1;
  if (callUp && putDown) return -1;
  return 0;
}

/** Gamma positioning from precomputed structureGamma (OI·|gamma| near ATM). */
function gammaDiscrete(g: -1 | 0 | 1): -1 | 0 | 1 {
  return g;
}

/**
 * Above VWAP + volume → +1 (strong if >5%, else moderate if >1%); below VWAP → -1; else 0.
 * Matches spec “strong volume” for full +1; modest activity still counts as directional lean.
 */
function momentumDiscrete(vwapScore: -1 | 0 | 1, volumeChangePct: number): -1 | 0 | 1 {
  if (vwapScore === -1) return -1;
  if (vwapScore === 1 && volumeChangePct > 5) return 1;
  if (vwapScore === 1 && volumeChangePct > 1) return 1;
  return 0;
}

/** All TFs same trend → ±1; mixed → 0 */
function alignmentDiscrete(
  t3: 'UP' | 'DOWN' | 'NEUTRAL',
  t5: 'UP' | 'DOWN' | 'NEUTRAL',
  t15: 'UP' | 'DOWN' | 'NEUTRAL',
): -1 | 0 | 1 {
  if (t3 === 'UP' && t5 === 'UP' && t15 === 'UP') return 1;
  if (t3 === 'DOWN' && t5 === 'DOWN' && t15 === 'DOWN') return -1;
  return 0;
}

function tierFromPercent(p: number): ConfidenceTier {
  if (p >= 85) return 'Very High';
  if (p >= 70) return 'High';
  if (p >= 50) return 'Medium';
  if (p >= 25) return 'Weak';
  return 'Low';
}

function directionFromScore(sum: number): ConfidenceDirection {
  if (sum > 0.02) return 'Bullish';
  if (sum < -0.02) return 'Bearish';
  return 'Neutral';
}

export interface ConfidenceEngineInput {
  symbol: string;
  spotPrice: number;
  rangeData: IndexRangeData | null;
  structurePCR: -1 | 0 | 1;
  structureCluster: -1 | 0 | 1;
  structureGamma: -1 | 0 | 1;
  oiChangeCE: number;
  oiChangePE: number;
  vwapScore: -1 | 0 | 1;
  volumeChangePct: number;
  trend3m: 'UP' | 'DOWN' | 'NEUTRAL';
  trend5m: 'UP' | 'DOWN' | 'NEUTRAL';
  trend15m: 'UP' | 'DOWN' | 'NEUTRAL';
  indiaVIX: number;
  totalOiChgAbsPct: number;
  /** Optional: scanner has directional setup */
  scannerHasSetup?: boolean;
  /** False until ≥2 OI snapshots exist — avoids labeling 0% OI Δ as “weak flow” on first tick */
  oiHistoryReady?: boolean;
}

export function buildConfidenceEngineOutput(input: ConfidenceEngineInput): ConfidenceEngineOutput {
  const sym = input.symbol.toUpperCase();
  const notes: string[] = [];

  const weights = WEIGHTS[sym] || WEIGHTS.NIFTY;

  let rangeState: RangeState = 'INNER_RANGE';
  let overlapPct = 0;
  let reliability: RangeReliability = 'LOW';

  if (input.rangeData && input.spotPrice > 0) {
    const { upper, lower, width } = combinedDailyBounds(input.rangeData);
    const tf = input.rangeData.daily;
    overlapPct = calculateOverlap(
      tf.atr.highRange,
      tf.atr.lowRange,
      tf.expectedMove.upperBound,
      tf.expectedMove.lowerBound,
    );
    reliability = overlapReliability(overlapPct);
    rangeState = classifyRangeState(input.spotPrice, upper, lower, width);
  } else {
    notes.push('Range data unavailable — overlap reliability defaulted to LOW.');
  }

  const comp: ComponentScores = {
    structure: structureDiscrete(input.structurePCR, input.structureCluster, input.structureGamma),
    oiFlow: oiFlowDiscrete(input.oiChangeCE, input.oiChangePE),
    gamma: gammaDiscrete(input.structureGamma),
    momentum: momentumDiscrete(input.vwapScore, input.volumeChangePct),
    alignment: alignmentDiscrete(input.trend3m, input.trend5m, input.trend15m),
  };

  const weightedSum =
    weights.structure * comp.structure +
    weights.oiFlow * comp.oiFlow +
    weights.gamma * comp.gamma +
    weights.momentum * comp.momentum +
    weights.alignment * comp.alignment;

  let raw = Math.round(((weightedSum + 1) / 2) * 100);
  raw = clamp(raw, 0, 100);

  const allNeutralBuckets =
    comp.structure === 0 &&
    comp.oiFlow === 0 &&
    comp.gamma === 0 &&
    comp.momentum === 0 &&
    comp.alignment === 0;
  if (allNeutralBuckets) {
    notes.push(
      'All discrete buckets neutral (±1 scale) — raw uses 50% baseline (no directional tilt from weighted sum).',
    );
  }

  let adj = raw;
  const dir = directionFromScore(weightedSum);

  // ── Range connection (inner / extreme only — deep range applied after conflict/reliability) ──
  if (rangeState === 'EXTREME') {
    adj = Math.round(adj * 0.85);
    notes.push('Extreme extension: confidence reduced 15%.');
  } else if (rangeState === 'INNER_RANGE') {
    adj = Math.round(adj * 0.92);
    notes.push('Inner range: confidence damped 8% (needs >60% effective for aggressive context).');
  }

  // ── Conflict engine (max −25) ───────────────────────────
  let conflict = 0;
  const momSign = comp.momentum;
  const structSign = comp.structure;
  const flowSign = comp.oiFlow;
  const dirSign = dir === 'Bullish' ? 1 : dir === 'Bearish' ? -1 : 0;

  if (dirSign !== 0 && momSign !== 0 && dirSign !== momSign) {
    conflict += 10;
    notes.push('Conflict: bias vs momentum (−10%).');
  }
  if (structSign !== 0 && flowSign !== 0 && structSign !== flowSign) {
    conflict += 10;
    notes.push('Conflict: OI flow vs structure (−10%).');
  }
  if (comp.gamma !== 0 && dirSign !== 0 && comp.gamma !== dirSign) {
    conflict += 5;
    notes.push('Conflict: gamma vs direction (−5%).');
  }
  conflict = Math.min(25, conflict);
  adj = Math.round(adj - conflict);

  // ── Reliability link (skipped when DEEP_RANGE — final is no-trade anyway) ──
  if (rangeState !== 'DEEP_RANGE') {
    if (reliability === 'MEDIUM') {
      adj -= 5;
      notes.push('Range reliability MEDIUM: −5%.');
    } else if (reliability === 'LOW') {
      adj -= 10;
      notes.push('Range reliability LOW: −10%.');
    }
  }

  adj = clamp(adj, 0, 100);
  const confidenceBeforeDeepRange = adj;

  if (rangeState === 'DEEP_RANGE') {
    adj = 0;
    notes.push(
      `Deep range: display confidence forced to 0 (no-trade context). Before this rule: ${confidenceBeforeDeepRange}%.`,
    );
  }

  // ── Index: BANKNIFTY note (threshold 60 for “strong” context) ──
  if (sym === 'BANKNIFTY' && adj < 60) {
    notes.push('BANKNIFTY: adjusted confidence below 60% — higher bar for strong context.');
  }

  const tier = tierFromPercent(adj);

  let tradeZone: ConfidenceEngineOutput['tradeZone'] = 'ACTIVE_CONTEXT';
  if (rangeState === 'DEEP_RANGE') tradeZone = 'NO_TRADE_ZONE';
  else if (rangeState === 'INNER_RANGE' || reliability === 'LOW') tradeZone = 'CAUTION';

  // Momentum status from volume + vwap
  let momentumStatus: ConfidenceEngineOutput['momentumStatus'] = 'Weakening';
  if (input.vwapScore === 1 && input.volumeChangePct > 8) momentumStatus = 'Strong';
  else if (input.vwapScore === -1 && input.volumeChangePct > 5) momentumStatus = 'Reversal';

  // Trigger (without blocking on heavy scanner — scanner flag passed in)
  const nearOrBreak = rangeState === 'NEAR_EDGE' || rangeState === 'BREAKOUT_ZONE';
  const scannerOk = input.scannerHasSetup === true;
  let triggerStatus: ConfidenceEngineOutput['triggerStatus'] = 'NONE';
  let triggerType: ConfidenceEngineOutput['triggerType'] = 'None';
  if (scannerOk && adj > 50 && nearOrBreak && rangeState !== 'EXTREME') {
    triggerStatus = adj >= 70 ? 'STRONG' : 'VALID';
    triggerType = rangeState === 'BREAKOUT_ZONE' ? 'Breakout' : 'Retest';
  }

  const triggerLevelHint =
    rangeState === 'BREAKOUT_ZONE'
      ? 'Key level: combined range boundary (breakout side)'
      : rangeState === 'NEAR_EDGE'
        ? 'Key level: range edge / VWAP proxy zone'
        : 'Awaiting clearer location vs combined ATR–EM band';

  const invalidationHint =
    rangeState === 'BREAKOUT_ZONE'
      ? 'Invalidation: opposite side of combined range / failed hold'
      : 'Invalidation: break back through opposing edge of day range';

  const targetZoneHint = 'Target zone: next logical structure (prev swing / range projection) — indicative only.';
  const extensionZoneHint = 'Extension: measured move beyond breakout boundary — watch exhaustion.';

  let marketProfile: ConfidenceEngineOutput['marketProfile'] = 'Stable';
  if (input.indiaVIX >= 18) marketProfile = 'Volatile';
  if (input.oiHistoryReady && input.totalOiChgAbsPct < 0.15) {
    // Near-zero OI Δ is usually “flat positioning”, not necessarily illiquid.
    marketProfile = input.totalOiChgAbsPct < 0.05 ? 'Stable OI' : 'Weak OI';
  }

  let scannerSetupStrength: ConfidenceEngineOutput['scannerSetupStrength'] = 'NO SETUP';
  if (scannerOk) {
    if (adj >= 70) scannerSetupStrength = 'HIGH';
    else if (adj >= 50) scannerSetupStrength = 'MEDIUM';
    else scannerSetupStrength = 'LOW';
  }

  return {
    pipelineOrder: 'Range → Confidence → Bias → Decision',
    rangeState,
    rangeReliability: reliability,
    overlapPercent: Math.round(overlapPct * 10) / 10,
    componentScores: comp,
    weightsUsed: { ...weights },
    confidenceRaw: raw,
    confidenceBeforeDeepRange,
    confidenceAdjusted: adj,
    confidenceTier: tier,
    direction: dir,
    tradeZone,
    adjustmentNotes: notes,
    triggerStatus,
    triggerType,
    triggerLevelHint,
    invalidationHint,
    targetZoneHint,
    extensionZoneHint,
    momentumStatus,
    marketProfile,
    scannerSetupStrength,
  };
}
