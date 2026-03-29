/**
 * Range Engine — Range + Expected Move Analysis
 *
 * Spec: Sections 1-13 (Rules 1-52)
 * Stateless engine: produces output solely based on input parameters.
 *
 * Pipeline Position: Data → Health → Scanner → **Range Engine** → Decision → Entry
 *
 * Priority Order (spec §48-51B):
 *   1. Edge cases (§45-47A)
 *   2. Overlap (§48)
 *   3. Alignment (§49)
 *   4. Expansion / Exhaustion (§50)
 *   5. Trade Zone (§51)  ← primary gating decision
 *   6. Market → Timing → Bias → Confidence (§51A)
 */

import {
  POSITION, EXPANSION_ZONE, ALIGNMENT_ZONE, TRADE_ZONE, MARKET_ZONE,
  TIMING_ZONE, BIAS_ZONE, CONFIDENCE_ZONE, GLOBAL_MARKET,
  type PositionType, type RangeType, type ExpansionZoneType,
  type AlignmentZoneType, type TradeZoneType, type MarketZoneType,
  type TimingZoneType, type BiasZoneType, type ConfidenceZoneType,
  type RangeEngineInput, type RangeOutput, type GlobalOutput,
  SUPPORTED_INDICES,
} from './constants';
import { configManager } from './configManager';

// ─────────────────────────────────────────────────────────────
//  INPUT VALIDATION (§6A-6B)
// ─────────────────────────────────────────────────────────────

function validateInput(input: Partial<RangeEngineInput>): RangeEngineInput | null {
  if (!input) return null;
  const validPositions = Object.values(POSITION);
  if (!input.atrPosition || !validPositions.includes(input.atrPosition as any)) return null;
  if (!input.emPosition || !validPositions.includes(input.emPosition as any)) return null;
  if (input.overlap == null || isNaN(input.overlap)) return null;
  if (input.atrWidth == null || isNaN(input.atrWidth) || input.atrWidth <= 0) return null;
  if (input.emWidth == null || isNaN(input.emWidth) || input.emWidth <= 0) return null;
  return input as RangeEngineInput;
}

function noTradeOutput(reason?: string): RangeOutput {
  return {
    tradeZone: TRADE_ZONE.NO_TRADE,
    marketZone: MARKET_ZONE.CONFLICT,
    biasZone: BIAS_ZONE.NEUTRAL,
    timingZone: TIMING_ZONE.UNDEFINED,
    confidenceZone: CONFIDENCE_ZONE.VERY_LOW,
    expansionZone: EXPANSION_ZONE.BALANCED,
    alignmentZone: ALIGNMENT_ZONE.CONFLICT,
    lateMove: false,
    guidance: reason || 'Do NOT trade — invalid or missing inputs',
  };
}

// ─────────────────────────────────────────────────────────────
//  DERIVED LAYER (§7-13A)
// ─────────────────────────────────────────────────────────────

/** §7-9: Expansion Zone */
function classifyExpansion(atrWidth: number, emWidth: number): ExpansionZoneType {
  const cfg = configManager.getSection('range');
  const ratio = ((emWidth - atrWidth) / atrWidth) * 100;
  if (ratio >= cfg.expansionThreshold) return EXPANSION_ZONE.EXPANSION;
  if (ratio <= -cfg.exhaustionThreshold) return EXPANSION_ZONE.EXHAUSTION;
  return EXPANSION_ZONE.BALANCED;
}

/** §10-12: Alignment Zone */
function classifyAlignment(atrPos: PositionType, emPos: PositionType, overlap: number): AlignmentZoneType {
  const cfg = configManager.getSection('range');
  if (atrPos === emPos) return ALIGNMENT_ZONE.STRONG;
  if (overlap >= cfg.alignmentPartialOverlap) return ALIGNMENT_ZONE.PARTIAL;
  return ALIGNMENT_ZONE.CONFLICT;
}

/** §13: Late Move Zone */
function isLateMove(atrPos: PositionType, emPos: PositionType, overlap: number): boolean {
  const cfg = configManager.getSection('range');
  return (
    (atrPos === POSITION.ABOVE_HIGH || atrPos === POSITION.BELOW_LOW) &&
    emPos === POSITION.IN_RANGE &&
    overlap < cfg.lateMoveOverlap
  );
}

// ─────────────────────────────────────────────────────────────
//  TRADE PERMISSION ZONE (§14-17A)
// ─────────────────────────────────────────────────────────────

function classifyTradeZone(
  atrPos: PositionType,
  emPos: PositionType,
  overlap: number,
  lateMove: boolean
): TradeZoneType {
  const cfg = configManager.getSection('range');

  // §14: Overlap < 15% → NO_TRADE
  if (overlap < cfg.noTradeOverlap) return TRADE_ZONE.NO_TRADE;

  // §15: Different positions + overlap < 30% → NO_TRADE
  if (atrPos !== emPos && overlap < cfg.conflictOverlap) return TRADE_ZONE.NO_TRADE;

  // §16: Late Move → WAIT
  if (lateMove) return TRADE_ZONE.WAIT;

  // §17: Otherwise → TRADE
  return TRADE_ZONE.TRADE;
}

// ─────────────────────────────────────────────────────────────
//  MARKET CONDITION ZONE (§18-23A)
// ─────────────────────────────────────────────────────────────

function classifyMarketZone(
  atrPos: PositionType,
  emPos: PositionType,
  overlap: number
): MarketZoneType {
  const cfg = configManager.getSection('range');

  // §18
  if (atrPos === POSITION.BELOW_LOW && emPos === POSITION.BELOW_LOW) return MARKET_ZONE.TREND_DOWN;
  // §19
  if (atrPos === POSITION.ABOVE_HIGH && emPos === POSITION.ABOVE_HIGH) return MARKET_ZONE.TREND_UP;
  // §20
  if (atrPos === POSITION.BELOW_LOW && emPos === POSITION.IN_RANGE) return MARKET_ZONE.WEAK_DOWN;
  // §21
  if (atrPos === POSITION.ABOVE_HIGH && emPos === POSITION.IN_RANGE) return MARKET_ZONE.WEAK_UP;
  // §22
  if (atrPos === POSITION.IN_RANGE && emPos === POSITION.IN_RANGE) return MARKET_ZONE.SIDEWAYS;
  // §23
  if (atrPos !== emPos && overlap < cfg.conflictOverlap) return MARKET_ZONE.CONFLICT;

  // Fallback — mixed but not conflicting
  return MARKET_ZONE.SIDEWAYS;
}

// ─────────────────────────────────────────────────────────────
//  TIMING ZONE (§24-27A)
// ─────────────────────────────────────────────────────────────

function classifyTimingZone(
  atrPos: PositionType,
  alignment: AlignmentZoneType,
  expansion: ExpansionZoneType,
  overlap: number,
  marketZone: MarketZoneType
): TimingZoneType {
  // §27: Alignment CONFLICT → UNDEFINED
  if (alignment === ALIGNMENT_ZONE.CONFLICT) return TIMING_ZONE.UNDEFINED;

  // §25: STRONG + EXPANSION → EARLY_TREND
  if (alignment === ALIGNMENT_ZONE.STRONG && expansion === EXPANSION_ZONE.EXPANSION) {
    return TIMING_ZONE.EARLY_TREND;
  }

  // §24: ATR IN_RANGE → EARLY
  if (atrPos === POSITION.IN_RANGE) return TIMING_ZONE.EARLY;

  // §26: Overlap < 40% in weak conditions
  const weakConditions = [MARKET_ZONE.WEAK_UP, MARKET_ZONE.WEAK_DOWN];
  if (overlap < 40 && weakConditions.includes(marketZone as any)) return TIMING_ZONE.LATE;

  return TIMING_ZONE.EARLY;
}

// ─────────────────────────────────────────────────────────────
//  DIRECTIONAL BIAS ZONE (§28-30A)
// ─────────────────────────────────────────────────────────────

function classifyBiasZone(atrPos: PositionType): BiasZoneType {
  if (atrPos === POSITION.BELOW_LOW) return BIAS_ZONE.BEARISH;     // §28
  if (atrPos === POSITION.ABOVE_HIGH) return BIAS_ZONE.BULLISH;    // §29
  return BIAS_ZONE.NEUTRAL;                                         // §30
}

// ─────────────────────────────────────────────────────────────
//  CONFIDENCE ZONE (§31-36A)
// ─────────────────────────────────────────────────────────────

function classifyConfidenceZone(
  overlap: number,
  alignment: AlignmentZoneType,
  marketZone: MarketZoneType
): ConfidenceZoneType {
  const cfg = configManager.getSection('confidence');

  // §31-34: Base classification from overlap
  let zone: ConfidenceZoneType;
  if (overlap > cfg.highThreshold) zone = CONFIDENCE_ZONE.HIGH;
  else if (overlap >= cfg.mediumThreshold) zone = CONFIDENCE_ZONE.MEDIUM;
  else if (overlap >= cfg.lowThreshold) zone = CONFIDENCE_ZONE.LOW;
  else zone = CONFIDENCE_ZONE.VERY_LOW;

  // §35: Downgrade when CONFLICT alignment
  if (alignment === ALIGNMENT_ZONE.CONFLICT) {
    if (zone === CONFIDENCE_ZONE.HIGH || zone === CONFIDENCE_ZONE.MEDIUM) {
      zone = CONFIDENCE_ZONE.LOW;
    } else {
      zone = CONFIDENCE_ZONE.VERY_LOW;
    }
  }

  // §36: Upgrade when TREND + STRONG alignment
  const trendMarkets: MarketZoneType[] = [MARKET_ZONE.TREND_UP, MARKET_ZONE.TREND_DOWN];
  if (trendMarkets.includes(marketZone) && alignment === ALIGNMENT_ZONE.STRONG) {
    if (zone === CONFIDENCE_ZONE.VERY_LOW) zone = CONFIDENCE_ZONE.LOW;
    else if (zone === CONFIDENCE_ZONE.LOW) zone = CONFIDENCE_ZONE.MEDIUM;
    else if (zone === CONFIDENCE_ZONE.MEDIUM) zone = CONFIDENCE_ZONE.HIGH;
    // HIGH stays HIGH
  }

  return zone;
}

// ─────────────────────────────────────────────────────────────
//  GUIDANCE TEXT (§39-41A)
// ─────────────────────────────────────────────────────────────

function getGuidance(tradeZone: TradeZoneType, biasZone: BiasZoneType): string {
  switch (tradeZone) {
    case TRADE_ZONE.NO_TRADE: return 'Do NOT trade';
    case TRADE_ZONE.WAIT: return 'Wait for pullback or alignment';
    case TRADE_ZONE.TRADE: return `Trades allowed in ${biasZone.toLowerCase()} direction`;
    default: return 'Do NOT trade';
  }
}

// ─────────────────────────────────────────────────────────────
//  EDGE CASE HANDLING (§45-47A) — evaluated BEFORE Trade Zone
// ─────────────────────────────────────────────────────────────

interface EdgeCaseResult {
  forced: boolean;
  tradeZone?: TradeZoneType;
  confidenceZone?: ConfidenceZoneType;
  alignmentZone?: AlignmentZoneType;
  expansionZone?: ExpansionZoneType;
}

function evaluateEdgeCases(
  input: RangeEngineInput,
  expansion: ExpansionZoneType
): EdgeCaseResult {
  const cfg = configManager.getSection('range');
  const result: EdgeCaseResult = { forced: false };

  // §45: Overlap < 10% → force NO_TRADE + VERY_LOW
  if (input.overlap < cfg.edgeCaseOverlapForce) {
    result.forced = true;
    result.tradeZone = TRADE_ZONE.NO_TRADE;
    result.confidenceZone = CONFIDENCE_ZONE.VERY_LOW;
  }

  // §46: Different positions + overlap < 20% → force CONFLICT + NO_TRADE
  if (input.atrPosition !== input.emPosition && input.overlap < cfg.edgeCaseConflictOverlap) {
    result.forced = true;
    result.tradeZone = TRADE_ZONE.NO_TRADE;
    result.alignmentZone = ALIGNMENT_ZONE.CONFLICT;
  }

  // §47: Force EXHAUSTION when EM significantly smaller than ATR
  if (input.emWidth < input.atrWidth * 0.7) {
    result.expansionZone = EXPANSION_ZONE.EXHAUSTION;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
//  MAIN ENGINE (§52-55A)
// ─────────────────────────────────────────────────────────────

/**
 * Compute Range Analysis Output.
 * Stateless — output depends solely on input parameters.
 * Sequence: Input → Derived → Trade Zone → Market → Timing → Bias → Confidence → Output
 */
export function computeRange(rawInput: Partial<RangeEngineInput>): RangeOutput {
  // §6A-6B: Validate input
  const input = validateInput(rawInput);
  if (!input) return noTradeOutput('Invalid or missing critical inputs');

  // §13A: Compute all derived variables BEFORE Trade Zone
  let expansionZone = classifyExpansion(input.atrWidth, input.emWidth);
  let alignmentZone = classifyAlignment(input.atrPosition, input.emPosition, input.overlap);
  const lateMove = isLateMove(input.atrPosition, input.emPosition, input.overlap);

  // §47A: Edge cases BEFORE Trade Zone confirmation
  const edge = evaluateEdgeCases(input, expansionZone);
  if (edge.expansionZone) expansionZone = edge.expansionZone;
  if (edge.alignmentZone) alignmentZone = edge.alignmentZone;

  // §51A: Trade Zone = primary gating decision
  let tradeZone: TradeZoneType;
  let confidenceZone: ConfidenceZoneType;

  if (edge.forced && edge.tradeZone) {
    tradeZone = edge.tradeZone;
  } else {
    tradeZone = classifyTradeZone(input.atrPosition, input.emPosition, input.overlap, lateMove);
  }

  // §51: Compute Market, Timing, Bias, Confidence AFTER Trade Zone
  const marketZone = classifyMarketZone(input.atrPosition, input.emPosition, input.overlap);
  const timingZone = classifyTimingZone(input.atrPosition, alignmentZone, expansionZone, input.overlap, marketZone);
  const biasZone = classifyBiasZone(input.atrPosition);

  if (edge.forced && edge.confidenceZone) {
    confidenceZone = edge.confidenceZone;
  } else {
    confidenceZone = classifyConfidenceZone(input.overlap, alignmentZone, marketZone);
  }

  const guidance = getGuidance(tradeZone, biasZone);

  return {
    tradeZone,
    marketZone,
    biasZone,
    timingZone,
    confidenceZone,
    expansionZone,
    alignmentZone,
    lateMove,
    guidance,
  };
}

// ─────────────────────────────────────────────────────────────
//  GLOBAL MARKET (§42-44B)
// ─────────────────────────────────────────────────────────────

/**
 * Compute Global Market Zone from all indices' rangeOutput.
 * §44B: Only after all individual index rangeOutput values are finalized.
 */
export function computeGlobal(indexResults: Record<string, RangeOutput>): GlobalOutput {
  const cfg = configManager.getSection('global');
  const entries = Object.entries(indexResults);
  const total = entries.length;

  if (total === 0) {
    return {
      globalTradeZone: GLOBAL_MARKET.NO_TRADE,
      globalGuidance: 'No index data available',
      indexResults,
    };
  }

  const noTradeCount = entries.filter(([, r]) => r.tradeZone === TRADE_ZONE.NO_TRADE).length;
  const tradeEntries = entries.filter(([, r]) => r.tradeZone === TRADE_ZONE.TRADE);

  // §42: > 60% in NO_TRADE → global NO_TRADE
  if (noTradeCount / total > cfg.noTradeThreshold) {
    return {
      globalTradeZone: GLOBAL_MARKET.NO_TRADE,
      globalGuidance: `Do NOT trade — ${noTradeCount}/${total} indices are NO_TRADE`,
      indexResults,
    };
  }

  // §44: Majority in TRADE with same bias → ALIGNED
  if (tradeEntries.length > total / 2) {
    const biases = tradeEntries.map(([, r]) => r.biasZone);
    const bullish = biases.filter(b => b === BIAS_ZONE.BULLISH).length;
    const bearish = biases.filter(b => b === BIAS_ZONE.BEARISH).length;
    if (bullish > tradeEntries.length / 2 || bearish > tradeEntries.length / 2) {
      const dir = bullish > bearish ? 'BULLISH' : 'BEARISH';
      return {
        globalTradeZone: GLOBAL_MARKET.ALIGNED,
        globalGuidance: `Market aligned ${dir} — ${tradeEntries.length}/${total} indices tradeable`,
        indexResults,
      };
    }
  }

  // §43: Mixed analytical outputs → SELECTIVE
  return {
    globalTradeZone: GLOBAL_MARKET.SELECTIVE,
    globalGuidance: `Mixed analytical outputs — act selectively`,
    indexResults,
  };
}

// ─────────────────────────────────────────────────────────────
//  HELPER: Derive ATR/EM Position from spot + range data
// ─────────────────────────────────────────────────────────────

/**
 * Classify spot price position relative to a range.
 * Used to convert ATR/EM range data → ABOVE_HIGH / IN_RANGE / BELOW_LOW.
 */
export function classifyPosition(spotPrice: number, high: number, low: number): PositionType {
  if (spotPrice > high) return POSITION.ABOVE_HIGH;
  if (spotPrice < low) return POSITION.BELOW_LOW;
  return POSITION.IN_RANGE;
}

/**
 * Calculate overlap percentage between two ranges.
 * Overlap = intersection / union * 100
 */
export function calculateOverlap(
  atrHigh: number, atrLow: number,
  emHigh: number, emLow: number
): number {
  const intersectionLow = Math.max(atrLow, emLow);
  const intersectionHigh = Math.min(atrHigh, emHigh);
  const intersection = Math.max(0, intersectionHigh - intersectionLow);

  const unionLow = Math.min(atrLow, emLow);
  const unionHigh = Math.max(atrHigh, emHigh);
  const union = unionHigh - unionLow;

  if (union <= 0) return 0;
  return Number(((intersection / union) * 100).toFixed(2));
}
