/**
 * FNO Dashboard — Unified Constants & Types
 *
 * All zone values use standardized UPPERCASE_UNDERSCORE constants.
 * No dynamic or free-text values are allowed.
 * Referenced by: rangeEngine, decisionEngine, healthEngine, riskEngine,
 *                triggerEngine, entryEngine, simulationEngine, configManager.
 */

// ─────────────────────────────────────────────────────────────
//  1. POSITION CONSTANTS (ATR / Expected Move)
// ─────────────────────────────────────────────────────────────

export const POSITION = {
  ABOVE_HIGH: 'ABOVE_HIGH',
  IN_RANGE: 'IN_RANGE',
  BELOW_LOW: 'BELOW_LOW',
} as const;
export type PositionType = (typeof POSITION)[keyof typeof POSITION];

// ─────────────────────────────────────────────────────────────
//  2. RANGE TYPE
// ─────────────────────────────────────────────────────────────

export const RANGE_TYPE = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
} as const;
export type RangeType = (typeof RANGE_TYPE)[keyof typeof RANGE_TYPE];

// ─────────────────────────────────────────────────────────────
//  3. DERIVED ZONES
// ─────────────────────────────────────────────────────────────

export const EXPANSION_ZONE = {
  EXPANSION: 'EXPANSION',
  EXHAUSTION: 'EXHAUSTION',
  BALANCED: 'BALANCED',
} as const;
export type ExpansionZoneType = (typeof EXPANSION_ZONE)[keyof typeof EXPANSION_ZONE];

export const ALIGNMENT_ZONE = {
  STRONG: 'STRONG',
  PARTIAL: 'PARTIAL',
  CONFLICT: 'CONFLICT',
} as const;
export type AlignmentZoneType = (typeof ALIGNMENT_ZONE)[keyof typeof ALIGNMENT_ZONE];

// ─────────────────────────────────────────────────────────────
//  4. TRADE ZONE (Primary Output)
// ─────────────────────────────────────────────────────────────

export const TRADE_ZONE = {
  TRADE: 'TRADE',
  WAIT: 'WAIT',
  NO_TRADE: 'NO_TRADE',
} as const;
export type TradeZoneType = (typeof TRADE_ZONE)[keyof typeof TRADE_ZONE];

// ─────────────────────────────────────────────────────────────
//  5. MARKET ZONE
// ─────────────────────────────────────────────────────────────

export const MARKET_ZONE = {
  TREND_DOWN: 'TREND_DOWN',
  TREND_UP: 'TREND_UP',
  WEAK_DOWN: 'WEAK_DOWN',
  WEAK_UP: 'WEAK_UP',
  SIDEWAYS: 'SIDEWAYS',
  CONFLICT: 'CONFLICT',
} as const;
export type MarketZoneType = (typeof MARKET_ZONE)[keyof typeof MARKET_ZONE];

// ─────────────────────────────────────────────────────────────
//  6. TIMING ZONE
// ─────────────────────────────────────────────────────────────

export const TIMING_ZONE = {
  EARLY: 'EARLY',
  EARLY_TREND: 'EARLY_TREND',
  LATE: 'LATE',
  UNDEFINED: 'UNDEFINED',
} as const;
export type TimingZoneType = (typeof TIMING_ZONE)[keyof typeof TIMING_ZONE];

// ─────────────────────────────────────────────────────────────
//  7. BIAS ZONE
// ─────────────────────────────────────────────────────────────

export const BIAS_ZONE = {
  BULLISH: 'BULLISH',
  BEARISH: 'BEARISH',
  NEUTRAL: 'NEUTRAL',
} as const;
export type BiasZoneType = (typeof BIAS_ZONE)[keyof typeof BIAS_ZONE];

// ─────────────────────────────────────────────────────────────
//  8. CONFIDENCE ZONE
// ─────────────────────────────────────────────────────────────

export const CONFIDENCE_ZONE = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  VERY_LOW: 'VERY_LOW',
} as const;
export type ConfidenceZoneType = (typeof CONFIDENCE_ZONE)[keyof typeof CONFIDENCE_ZONE];

// ─────────────────────────────────────────────────────────────
//  9. GLOBAL MARKET
// ─────────────────────────────────────────────────────────────

export const GLOBAL_MARKET = {
  NO_TRADE: 'NO_TRADE',
  SELECTIVE: 'SELECTIVE',
  ALIGNED: 'ALIGNED',
} as const;
export type GlobalMarketType = (typeof GLOBAL_MARKET)[keyof typeof GLOBAL_MARKET];

// ─────────────────────────────────────────────────────────────
//  10. SYSTEM HEALTH
// ─────────────────────────────────────────────────────────────

export const SYSTEM_STATE = {
  ACTIVE: 'ACTIVE',
  HALTED: 'HALTED',
  DISABLED: 'DISABLED',
  ERROR: 'ERROR',
} as const;
export type SystemStateType = (typeof SYSTEM_STATE)[keyof typeof SYSTEM_STATE];

export const HEALTH_MODE = {
  NORMAL: 'NORMAL',
  CAUTION: 'CAUTION',
  RESTRICTED: 'RESTRICTED',
  HALT: 'HALT',
} as const;
export type HealthModeType = (typeof HEALTH_MODE)[keyof typeof HEALTH_MODE];

export const FEED_STATUS = {
  LIVE: 'LIVE',
  STALE: 'STALE',
  DEAD: 'DEAD',
} as const;
export type FeedStatusType = (typeof FEED_STATUS)[keyof typeof FEED_STATUS];

export const API_STATUS = {
  OK: 'OK',
  SLOW: 'SLOW',
  DEGRADED: 'DEGRADED',
  DOWN: 'DOWN',
  FAIL: 'FAIL',
} as const;
export type ApiStatusType = (typeof API_STATUS)[keyof typeof API_STATUS];

export const DATA_INTEGRITY = {
  CLEAN: 'CLEAN',
  PARTIAL: 'PARTIAL',
  CORRUPT: 'CORRUPT',
} as const;
export type DataIntegrityType = (typeof DATA_INTEGRITY)[keyof typeof DATA_INTEGRITY];

export const LATENCY_CLASS = {
  GOOD: 'GOOD',
  MODERATE: 'MODERATE',
  RISK: 'RISK',
  CRITICAL: 'CRITICAL',
} as const;
export type LatencyClassType = (typeof LATENCY_CLASS)[keyof typeof LATENCY_CLASS];

// ─────────────────────────────────────────────────────────────
//  11. DECISION ENGINE
// ─────────────────────────────────────────────────────────────

export const DECISION = {
  BUY: 'BUY',
  SELL: 'SELL',
  NO_TRADE: 'NO_TRADE',
  WAIT: 'WAIT',
} as const;
export type DecisionType = (typeof DECISION)[keyof typeof DECISION];

export const STRENGTH = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  VERY_LOW: 'VERY_LOW',
} as const;
export type StrengthType = (typeof STRENGTH)[keyof typeof STRENGTH];

// ─────────────────────────────────────────────────────────────
//  12. TRIGGER ENGINE
// ─────────────────────────────────────────────────────────────

export const TRIGGER_TYPE = {
  GAMMA_BREAK: 'GAMMA_BREAK',
  FLOW_DOMINANCE: 'FLOW_DOMINANCE',
  MOMENTUM: 'MOMENTUM',
  RETEST: 'RETEST',
  BREAKOUT: 'BREAKOUT',
  NONE: 'NONE',
} as const;
export type TriggerTypeValue = (typeof TRIGGER_TYPE)[keyof typeof TRIGGER_TYPE];

// ─────────────────────────────────────────────────────────────
//  13. MARKET CONTEXT
// ─────────────────────────────────────────────────────────────

export const MARKET_TYPE = {
  TRENDING: 'TRENDING',
  SIDEWAYS: 'SIDEWAYS',
  VOLATILE: 'VOLATILE',
} as const;
export type MarketTypeValue = (typeof MARKET_TYPE)[keyof typeof MARKET_TYPE];

export const MARKET_STATE = {
  TRENDING: 'TRENDING',
  MIXED: 'MIXED',
  RISKY: 'RISKY',
} as const;
export type MarketStateValue = (typeof MARKET_STATE)[keyof typeof MARKET_STATE];

export const MARKET_PHASE = {
  PRE_MARKET: 'PRE_MARKET',
  LIVE_MARKET: 'LIVE_MARKET',
  POST_MARKET: 'POST_MARKET',
} as const;
export type MarketPhaseType = (typeof MARKET_PHASE)[keyof typeof MARKET_PHASE];

export const VOLATILITY_LEVEL = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  EXTREME: 'EXTREME',
} as const;
export type VolatilityLevelType = (typeof VOLATILITY_LEVEL)[keyof typeof VOLATILITY_LEVEL];

export const VWAP_POSITION = {
  ABOVE: 'ABOVE',
  BELOW: 'BELOW',
  AT: 'AT',
} as const;
export type VwapPositionType = (typeof VWAP_POSITION)[keyof typeof VWAP_POSITION];

export const GAMMA_TYPE = {
  POSITIVE: 'POSITIVE',
  NEGATIVE: 'NEGATIVE',
} as const;
export type GammaSignType = (typeof GAMMA_TYPE)[keyof typeof GAMMA_TYPE];

export const TIME_STRENGTH = {
  WEAK: 'WEAK',
  MODERATE: 'MODERATE',
  STRONG: 'STRONG',
} as const;
export type TimeStrengthType = (typeof TIME_STRENGTH)[keyof typeof TIME_STRENGTH];

// ─────────────────────────────────────────────────────────────
//  14. SIGNAL STATUS
// ─────────────────────────────────────────────────────────────

export const SIGNAL_STATUS = {
  EXECUTED: 'EXECUTED',
  REJECTED: 'REJECTED',
  BLOCKED: 'BLOCKED',
} as const;
export type SignalStatusType = (typeof SIGNAL_STATUS)[keyof typeof SIGNAL_STATUS];

// ─────────────────────────────────────────────────────────────
//  15. TRADE / EXIT TYPES
// ─────────────────────────────────────────────────────────────

export const EXIT_REASON = {
  STOP_LOSS: 'STOP_LOSS',
  TARGET_HIT: 'TARGET_HIT',
  TIME_EXIT: 'TIME_EXIT',
  MANUAL_EXIT: 'MANUAL_EXIT',
  TRAILING_STOP: 'TRAILING_STOP',
  OPPOSITE_SIGNAL: 'OPPOSITE_SIGNAL',
  INDEX_DIRECTION_FLIP: 'INDEX_DIRECTION_FLIP',
  GAMMA_RISK: 'GAMMA_RISK',
  OI_SHIFT: 'OI_SHIFT',
  IV_SPIKE: 'IV_SPIKE',
  SIGNAL_DECAY: 'SIGNAL_DECAY',
  PREMIUM_WEAKNESS: 'PREMIUM_WEAKNESS',
  HARD_SL: 'HARD_SL',
  /** Trend / swing structure invalidated before hard SL */
  STRUCTURE_BREAK: 'STRUCTURE_BREAK',
  /** No meaningful price movement for N bars */
  STAGNATION_EXIT: 'STAGNATION_EXIT',
  /** Volume dried up with no continuation */
  VOLUME_STALL_EXIT: 'VOLUME_STALL_EXIT',
} as const;
export type ExitReasonType = (typeof EXIT_REASON)[keyof typeof EXIT_REASON];

export const TRADE_STATUS = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  RUNNING: 'RUNNING',
} as const;
export type TradeStatusType = (typeof TRADE_STATUS)[keyof typeof TRADE_STATUS];

export const TRADE_CLASSIFICATION = {
  MOMENTUM: 'MOMENTUM',
  BREAKOUT: 'BREAKOUT',
  REVERSAL: 'REVERSAL',
} as const;
export type TradeClassificationType = (typeof TRADE_CLASSIFICATION)[keyof typeof TRADE_CLASSIFICATION];

export const THETA_IMPACT = {
  LOW: 'LOW',
  MODERATE: 'MODERATE',
  HIGH: 'HIGH',
} as const;
export type ThetaImpactType = (typeof THETA_IMPACT)[keyof typeof THETA_IMPACT];

export const FLOW_CONFIRMATION = {
  POSITIVE: 'POSITIVE',
  NEGATIVE: 'NEGATIVE',
  NEUTRAL: 'NEUTRAL',
} as const;
export type FlowConfirmationType = (typeof FLOW_CONFIRMATION)[keyof typeof FLOW_CONFIRMATION];

// ─────────────────────────────────────────────────────────────
//  16. SIMULATION MODE
// ─────────────────────────────────────────────────────────────

export const SIM_MODE = {
  SIMULATION: 'SIMULATION',
  LIVE: 'LIVE',
} as const;
export type SimModeType = (typeof SIM_MODE)[keyof typeof SIM_MODE];

// ─────────────────────────────────────────────────────────────
//  17. ORDER TYPES
// ─────────────────────────────────────────────────────────────

export const ORDER_TYPE = {
  MARKET: 'MARKET',
  LIMIT: 'LIMIT',
  STOP_LOSS: 'STOP_LOSS',
} as const;
export type OrderTypeValue = (typeof ORDER_TYPE)[keyof typeof ORDER_TYPE];

// ─────────────────────────────────────────────────────────────
//  COMPOSITE TYPES / INTERFACES
// ─────────────────────────────────────────────────────────────

/** Range Engine Input */
export interface RangeEngineInput {
  atrPosition: PositionType;
  emPosition: PositionType;
  overlap: number;           // 0-100
  atrWidth: number;
  emWidth: number;
  rangeType: RangeType;
  spotPrice?: number;
}

/** Range Engine Output (spec §8, §37-38) */
export interface RangeOutput {
  tradeZone: TradeZoneType;
  marketZone: MarketZoneType;
  biasZone: BiasZoneType;
  timingZone: TimingZoneType;
  confidenceZone: ConfidenceZoneType;
  expansionZone: ExpansionZoneType;
  alignmentZone: AlignmentZoneType;
  lateMove: boolean;
  guidance: string;
}

/** Global Output (spec §44A-B) */
export interface GlobalOutput {
  globalTradeZone: GlobalMarketType;
  globalGuidance: string;
  indexResults: Record<string, RangeOutput>;
}

/** System Health Output */
export interface HealthOutput {
  latencyMs: number;
  latencyClass: LatencyClassType;
  cacheAgeSec: number;
  noTickTimeSec: number;
  feedStatus: FeedStatusType;
  apiStatus: ApiStatusType;
  dataIntegrity: DataIntegrityType;
  healthScore: number;            // 0-100
  systemMode: HealthModeType;
  systemState: SystemStateType;
  signal: DecisionType | 'NONE';
  decision: TradeZoneType;
  topReasons: string[];
}

/** Decision Engine Output */
export interface DecisionOutput {
  decision: DecisionType;
  /** Derived only from confidence score bands (not a separate calculation). */
  strength: StrengthType;
  direction: 'BUY' | 'SELL' | null;
  tradeZone: TradeZoneType;
  rangeOutput: RangeOutput | null;
  healthOutput: HealthOutput | null;
  /** Unified score (formerly separate verification + probability). 0–100 */
  confidenceScore: number;
  /** When true, simulated execution must not proceed despite direction. */
  mtfExecutionBlocked: boolean;
  /** Scanner direction for display when zone blocks execution. */
  analyticalDirection: 'BUY' | 'SELL' | null;
  explanation: string;
  rejections: RejectionEntry[];
  pipelineTrace: PipelineStage[];
}

/** Trigger Engine Output */
export interface TriggerOutput {
  triggered: boolean;
  triggerType: TriggerTypeValue;
  priority: number;
  details: string;
}

/** Entry Engine Output */
export interface EntryOutput {
  allowed: boolean;
  orderType: OrderTypeValue;
  entryType: 'BREAKOUT' | 'RETEST';
  reason: string;
  estimatedSlippage: number;
}

/** Risk Engine Output */
export interface RiskOutput {
  allowed: boolean;
  positionSize: number;
  riskAmount: number;
  capitalAllocated: number;
  reason: string;
}

/** Rejection Entry */
export interface RejectionEntry {
  timestamp: number;
  reason: string;
  ruleNumber: number;
  module: string;
}

/** Pipeline Trace Stage */
export interface PipelineStage {
  stage: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
  timestamp: number;
}

/** Trade Object (spec G2, §235) */
export interface TradeObject {
  tradeId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  optionType: 'CE' | 'PE';
  strike: number;
  entryPrice: number;
  exitPrice: number | null;
  currentPrice: number;
  quantity: number;
  status: TradeStatusType;
  entryTime: number;
  exitTime: number | null;
  stopLoss: number;
  target: number;
  trailingStopLoss: number | null;
  confidenceScore: number;
  strength: StrengthType;
  confidence: ConfidenceZoneType;
  tradeZone: TradeZoneType;
  triggerType: TriggerTypeValue;
  tradeType: TradeClassificationType;
  unrealizedPnl: number;
  realizedPnl: number;
  peakPrice: number;
  duration: number;               // ms since entry
  exitReason: ExitReasonType | null;
  context: TradeContext;
  /** Optional live hints from market feed (structure, stagnation, etc.) */
  liveExitHints?: {
    structureBroken?: boolean;
    stagnationBars?: number;
    volumeStalled?: boolean;
    oppositeSetup?: boolean;
  };
}

/** Context data stored with each trade */
export interface TradeContext {
  vix: number;
  vwap: number;
  gamma: string;
  timeStrength: string;
  marketState: string;
  flowScore: number;
  iv: number;
  overlap: number;
}

/** Simulation Account */
export interface SimulationAccount {
  initialCapital: number;
  accountBalance: number;
  availableCapital: number;
  usedCapital: number;
  dailyPnl: number;
  totalPnl: number;
  mode: SimModeType;
}

/** Performance Metrics */
export interface PerformanceMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgProfit: number;
  avgLoss: number;
  maxDrawdown: number;
  bestTrade: number;
  worstTrade: number;
}

/** Score Breakdown */
export interface ScoreBreakdown {
  volume: number;
  oi: number;
  vwap: number;
  flow: number;
  momentum: number;
  gamma: number;
  total: number;
}

/** Confidence Breakdown */
export interface ConfidenceBreakdown {
  alignment: number;
  flow: number;
  volatility: number;
  score: number;
  marketContext: number;
  timeframe: number;
  total: number;
}

// ─────────────────────────────────────────────────────────────
//  SUPPORTED INDICES
// ─────────────────────────────────────────────────────────────

export const SUPPORTED_INDICES = [
  'NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCAPNIFTY', 'SENSEX', 'BANKEX'
] as const;

// ─────────────────────────────────────────────────────────────
//  SIMULATION PIN — use env SIMULATION_PIN_HASH (sha256 hex of PIN) or
// SIMULATION_DEFAULT_PIN for dev default; never commit plaintext pins.
// ─────────────────────────────────────────────────────────────
