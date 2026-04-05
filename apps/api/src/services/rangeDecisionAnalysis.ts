/**
 * RANGE + EXPECTED MOVE — Decision panel (educational / non-advisory).
 * All inputs from live marketRangeService data — no synthetic values.
 */

import type { AllIndicesRangeData, CombinedRangeData, IndexRangeData } from './marketRangeService';
import { calculateOverlap } from './engines/rangeEngine';

export type RangeTimeframe = 'daily' | 'weekly' | 'monthly';

/** Must match marketRangeService.getAllIndicesRangeData() order / symbols */
export const RANGE_PRIMARY_SYMBOLS = [
  'NIFTY',
  'BANKNIFTY',
  'FINNIFTY',
  'MIDCAPNIFTY',
  'SENSEX',
  'BANKEX',
] as const;

export type PrimarySymbol = (typeof RANGE_PRIMARY_SYMBOLS)[number];

export type MarketStateLabel = 'RANGE' | 'BREAKOUT UP' | 'BREAKOUT DOWN';
export type ConfidenceLabel = 'HIGH' | 'MEDIUM' | 'LOW';
export type VolatilityLabel = 'EXPANDING' | 'CONTRACTING' | 'NEUTRAL';
export type AlignmentLabel = 'STRONG ALIGNED' | 'PARTIAL ALIGNED' | 'DIVERGENCE';
export type DistanceLabel = 'NEAR EDGE' | 'MID RANGE';
export type EdgeLabel = 'NO EDGE' | 'RANGE EDGE' | 'TREND EDGE';
export type SetupLabel = 'NO CLEAR SETUP' | 'RANGE SETUP' | 'TREND SETUP';
export type StrategyLabel = 'NONE' | 'RANGE STRATEGY' | 'TREND STRATEGY';
export type TimingLabel = 'CONDITIONS MET' | 'EDGE ZONE' | 'CONDITIONS FORMING';

export interface RangeDecisionPanel {
  primarySymbol: PrimarySymbol;
  timeframe: RangeTimeframe;
  dataAvailable: boolean;
  dataIssue?: string;
  overlapPercent: number;
  marketState: MarketStateLabel;
  confidence: ConfidenceLabel;
  volatility: VolatilityLabel;
  alignment: AlignmentLabel;
  distance: DistanceLabel;
  edge: EdgeLabel;
  setup: SetupLabel;
  strategy: StrategyLabel;
  timing: TimingLabel;
  volatilityUsage: string;
  reasons: string[];
}

export type DecisionsBundle = Record<
  RangeTimeframe,
  Record<PrimarySymbol, RangeDecisionPanel>
>;

function pickTf(idx: IndexRangeData, tf: RangeTimeframe): CombinedRangeData {
  return idx[tf];
}

/** Union envelope of ATR band and EM band (same as legacy combined table). */
function combinedBounds(tf: CombinedRangeData): { upper: number; lower: number; width: number } {
  const upper = Math.max(tf.atr.highRange, tf.expectedMove.upperBound);
  const lower = Math.min(tf.atr.lowRange, tf.expectedMove.lowerBound);
  const width = upper - lower;
  return { upper, lower, width };
}

function marketStateFromSpot(spot: number, upper: number, lower: number): MarketStateLabel {
  if (spot > upper) return 'BREAKOUT UP';
  if (spot < lower) return 'BREAKOUT DOWN';
  return 'RANGE';
}

function confidenceFromOverlap(overlap: number): ConfidenceLabel {
  if (overlap >= 70) return 'HIGH';
  if (overlap >= 50) return 'MEDIUM';
  return 'LOW';
}

function volatilityFromWidths(tf: CombinedRangeData): VolatilityLabel {
  const atrW = tf.atr.rangeWidth;
  const emW = tf.expectedMove.upperBound - tf.expectedMove.lowerBound;
  if (atrW > emW) return 'EXPANDING';
  if (emW > atrW) return 'CONTRACTING';
  return 'NEUTRAL';
}

function distanceLabel(spot: number, upper: number, lower: number, width: number): DistanceLabel {
  if (width <= 0 || !Number.isFinite(spot)) return 'MID RANGE';
  let distToBoundary: number;
  if (spot >= lower && spot <= upper) {
    distToBoundary = Math.min(spot - lower, upper - spot);
  } else if (spot > upper) {
    distToBoundary = spot - upper;
  } else {
    distToBoundary = lower - spot;
  }
  const ratio = distToBoundary / width;
  return ratio <= 0.2 ? 'NEAR EDGE' : 'MID RANGE';
}

function alignmentLabel(states: MarketStateLabel[]): AlignmentLabel {
  if (states.length === 0) return 'DIVERGENCE';
  const counts = new Map<MarketStateLabel, number>();
  for (const s of states) {
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let max = 0;
  for (const c of counts.values()) max = Math.max(max, c);
  const n = states.length;
  if (max === n) return 'STRONG ALIGNED';
  if (max >= 3) return 'PARTIAL ALIGNED';
  return 'DIVERGENCE';
}

function isAligned(a: AlignmentLabel): boolean {
  return a === 'STRONG ALIGNED' || a === 'PARTIAL ALIGNED';
}

function deriveEdge(
  marketState: MarketStateLabel,
  confidence: ConfidenceLabel,
  alignment: AlignmentLabel,
  distance: DistanceLabel,
): EdgeLabel {
  if (confidence === 'LOW') return 'NO EDGE';
  if (alignment === 'DIVERGENCE') return 'NO EDGE';
  if (
    marketState === 'RANGE'
    && confidence === 'HIGH'
    && isAligned(alignment)
    && distance === 'NEAR EDGE'
  ) {
    return 'RANGE EDGE';
  }
  if (
    (marketState === 'BREAKOUT UP' || marketState === 'BREAKOUT DOWN')
    && (confidence === 'MEDIUM' || confidence === 'HIGH')
    && isAligned(alignment)
  ) {
    return 'TREND EDGE';
  }
  return 'NO EDGE';
}

function deriveSetup(
  edge: EdgeLabel,
  confidence: ConfidenceLabel,
  alignment: AlignmentLabel,
  marketState: MarketStateLabel,
  distance: DistanceLabel,
): SetupLabel {
  if (confidence === 'LOW') return 'NO CLEAR SETUP';
  if (alignment === 'DIVERGENCE') return 'NO CLEAR SETUP';
  if (marketState === 'RANGE' && distance === 'MID RANGE') return 'NO CLEAR SETUP';
  if (edge === 'NO EDGE') return 'NO CLEAR SETUP';
  if (edge === 'RANGE EDGE') return 'RANGE SETUP';
  if (edge === 'TREND EDGE') return 'TREND SETUP';
  return 'NO CLEAR SETUP';
}

function deriveStrategy(setup: SetupLabel): StrategyLabel {
  if (setup === 'RANGE SETUP') return 'RANGE STRATEGY';
  if (setup === 'TREND SETUP') return 'TREND STRATEGY';
  return 'NONE';
}

function deriveTiming(setup: SetupLabel, edge: EdgeLabel, vol: VolatilityLabel): TimingLabel {
  if (setup === 'NO CLEAR SETUP') return 'CONDITIONS FORMING';
  if (edge === 'TREND EDGE' && vol === 'EXPANDING') return 'CONDITIONS MET';
  if (edge === 'RANGE EDGE' && vol === 'CONTRACTING') return 'EDGE ZONE';
  return 'CONDITIONS FORMING';
}

function volatilityUsageText(vol: VolatilityLabel): string {
  if (vol === 'EXPANDING') return 'Expanding volatility — historically associated with breakout-type conditions (educational context only).';
  if (vol === 'CONTRACTING') return 'Contracting volatility — historically associated with range-type conditions (educational context only).';
  return 'Neutral ATR vs expected-move width — no clear expansion or contraction bias.';
}

function buildReasons(
  overlap: number,
  conf: ConfidenceLabel,
  marketState: MarketStateLabel,
  alignment: AlignmentLabel,
  vol: VolatilityLabel,
): string[] {
  const o = `Overlap between ATR and expected-move bands is ${overlap.toFixed(1)}% (${conf} confidence).`;
  const m = `Primary market state vs combined band: ${marketState}.`;
  const a = `Cross-index alignment: ${alignment}.`;
  const v =
    vol === 'EXPANDING'
      ? 'Volatility: EXPANDING (ATR range width greater than expected-move width).'
      : vol === 'CONTRACTING'
        ? 'Volatility: CONTRACTING (expected-move width greater than ATR range width).'
        : 'Volatility: NEUTRAL (ATR width ≈ expected-move width).';
  return [o, m, a, v];
}

function indexBySymbol(all: AllIndicesRangeData, sym: string): IndexRangeData | undefined {
  return all.indices.find(i => i.symbol.toUpperCase() === sym.toUpperCase());
}

/**
 * Single decision panel for one primary index and timeframe.
 */
export function computeRangeDecisionPanel(
  all: AllIndicesRangeData,
  timeframe: RangeTimeframe,
  primary: PrimarySymbol,
): RangeDecisionPanel {
  const primaryRow = indexBySymbol(all, primary);
  if (!primaryRow || primaryRow.spotPrice <= 0) {
    return {
      primarySymbol: primary,
      timeframe,
      dataAvailable: false,
      dataIssue: 'Spot or index data unavailable for primary symbol.',
      overlapPercent: 0,
      marketState: 'RANGE',
      confidence: 'LOW',
      volatility: 'NEUTRAL',
      alignment: 'DIVERGENCE',
      distance: 'MID RANGE',
      edge: 'NO EDGE',
      setup: 'NO CLEAR SETUP',
      strategy: 'NONE',
      timing: 'CONDITIONS FORMING',
      volatilityUsage: volatilityUsageText('NEUTRAL'),
      reasons: ['Live range data is incomplete for this symbol — refresh or verify market data.'],
    };
  }

  const tf = pickTf(primaryRow, timeframe);
  const { upper, lower, width } = combinedBounds(tf);
  if (width <= 0 || !Number.isFinite(upper) || !Number.isFinite(lower)) {
    return {
      primarySymbol: primary,
      timeframe,
      dataAvailable: false,
      dataIssue: 'Combined range width is zero — insufficient candle history.',
      overlapPercent: 0,
      marketState: 'RANGE',
      confidence: 'LOW',
      volatility: 'NEUTRAL',
      alignment: 'DIVERGENCE',
      distance: 'MID RANGE',
      edge: 'NO EDGE',
      setup: 'NO CLEAR SETUP',
      strategy: 'NONE',
      timing: 'CONDITIONS FORMING',
      volatilityUsage: volatilityUsageText('NEUTRAL'),
      reasons: ['Not enough reliable OHLC history to form ATR/EM bands for this timeframe.'],
    };
  }

  const overlap = calculateOverlap(
    tf.atr.highRange,
    tf.atr.lowRange,
    tf.expectedMove.upperBound,
    tf.expectedMove.lowerBound,
  );
  const confidence = confidenceFromOverlap(overlap);
  const volatility = volatilityFromWidths(tf);
  const spot = primaryRow.spotPrice;
  const marketState = marketStateFromSpot(spot, upper, lower);
  const distance = distanceLabel(spot, upper, lower, width);

  const states: MarketStateLabel[] = [];
  for (const idx of all.indices) {
    const t = pickTf(idx, timeframe);
    const b = combinedBounds(t);
    if (idx.spotPrice <= 0 || b.width <= 0) continue;
    states.push(marketStateFromSpot(idx.spotPrice, b.upper, b.lower));
  }
  const alignment = alignmentLabel(states);

  const edge = deriveEdge(marketState, confidence, alignment, distance);
  const setup = deriveSetup(edge, confidence, alignment, marketState, distance);
  const strategy = deriveStrategy(setup);
  const timing = deriveTiming(setup, edge, volatility);

  const reasons = buildReasons(overlap, confidence, marketState, alignment, volatility);

  return {
    primarySymbol: primary,
    timeframe,
    dataAvailable: true,
    overlapPercent: overlap,
    marketState,
    confidence,
    volatility,
    alignment,
    distance,
    edge,
    setup,
    strategy,
    timing: setup === 'NO CLEAR SETUP' ? 'CONDITIONS FORMING' : timing,
    volatilityUsage: volatilityUsageText(volatility),
    reasons,
  };
}

export function buildDecisionsBundle(all: AllIndicesRangeData): DecisionsBundle {
  const tfs: RangeTimeframe[] = ['daily', 'weekly', 'monthly'];
  const out = {} as DecisionsBundle;
  for (const tf of tfs) {
    const row = {} as Record<PrimarySymbol, RangeDecisionPanel>;
    for (const sym of RANGE_PRIMARY_SYMBOLS) {
      row[sym] = computeRangeDecisionPanel(all, tf, sym);
    }
    out[tf] = row;
  }
  return out;
}
