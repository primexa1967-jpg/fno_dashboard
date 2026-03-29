/**
 * Decision Engine — Analytical direction (BUY/SELL/WAIT/NO_TRADE) from scanner + health.
 *
 * Trade Zone from Range Engine is the master gate for simulated execution; directional
 * output here is for analytics and is combined with the zone in the pipeline.
 *
 * Pipeline: Data → Health → Scanner → Range → **Decision** → Confidence score → Trigger → Entry
 */

import {
  DECISION, STRENGTH, TRADE_ZONE,
  type DecisionType, type StrengthType, type TradeZoneType,
  type DecisionOutput, type RangeOutput, type HealthOutput,
  type RejectionEntry, type PipelineStage,
  HEALTH_MODE, SYSTEM_STATE,
} from './constants';
import { configManager } from './configManager';
import { healthEngine } from './healthEngine';

// ─────────────────────────────────────────────────────────────
//  SCANNER MODEL OUTPUT (from existing scannerEngine)
// ─────────────────────────────────────────────────────────────

export interface ScannerModelOutput {
  signal: 'BUY' | 'SELL' | 'NONE';
  entryScore: number;
  winProb: number;
  rr: number;
  flowScore: number;
  flowAlign: boolean;
  htfDirection: string;
  mtfDirection: string;
  ltfDirection: string;
  indexDirection: string;
  overlap: number;
  confidence: number;
  delta: string;
  marketStructure: string;
}

/** @deprecated use ScannerModelOutput */
export type ScannerSignal = ScannerModelOutput;

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────

function tfAligned(hta: string, mta: string): boolean {
  const n = (s: string) => (s || '').toUpperCase();
  const a = n(hta);
  const b = n(mta);
  if (a === 'NEUTRAL' || b === 'NEUTRAL') return false;
  return a === b;
}

function strengthFromConfidenceScore(score: number): StrengthType {
  if (score >= 75) return STRENGTH.HIGH;
  if (score >= 60) return STRENGTH.MEDIUM;
  if (score >= 50) return STRENGTH.LOW;
  return STRENGTH.VERY_LOW;
}

// ─────────────────────────────────────────────────────────────
//  DECISION ENGINE
// ─────────────────────────────────────────────────────────────

class DecisionEngine {
  private lastDecisions: Map<string, DecisionOutput> = new Map();

  evaluate(
    symbol: string,
    scanner: ScannerModelOutput | null,
    rangeOutput: RangeOutput | null,
    healthOutput?: HealthOutput,
    marketContext?: { vix?: number }
  ): DecisionOutput {
    const trace: PipelineStage[] = [];
    const rejections: RejectionEntry[] = [];
    const now = Date.now();

    const health = healthOutput || healthEngine.evaluate(marketContext);
    trace.push({ stage: 'Health', status: 'PASS', detail: `Mode=${health.systemMode} Score=${health.healthScore}`, timestamp: now });

    if (health.systemState === SYSTEM_STATE.HALTED || health.systemMode === HEALTH_MODE.HALT) {
      rejections.push({ timestamp: now, reason: 'System HALTED', ruleNumber: 1, module: 'Health' });
      trace.push({ stage: 'Health', status: 'FAIL', detail: 'System halted — blocking simulated activity', timestamp: now });
      return this.buildOutput(
        DECISION.NO_TRADE, STRENGTH.VERY_LOW, null, TRADE_ZONE.NO_TRADE, rangeOutput, health, 0,
        'System HALTED — no simulated activity', rejections, trace, false, null
      );
    }

    if (!scanner || scanner.signal === 'NONE') {
      rejections.push({ timestamp: now, reason: 'No scanner model output', ruleNumber: 22, module: 'Scanner' });
      trace.push({ stage: 'Scanner', status: 'FAIL', detail: 'No valid model output from scanner', timestamp: now });
      return this.buildOutput(
        DECISION.NO_TRADE, STRENGTH.VERY_LOW, null, TRADE_ZONE.NO_TRADE, rangeOutput, health, 0,
        'No valid scanner model output', rejections, trace, false, null
      );
    }

    trace.push({
      stage: 'Scanner',
      status: 'PASS',
      detail: `ModelOutput=${scanner.signal} Score=${scanner.entryScore}`,
      timestamp: now,
    });

    // Flow must confirm OI/gamma structure — not price-led setups
    const flowConfirms =
      scanner.flowAlign !== false || (scanner.flowScore ?? 0) > 0;
    if (!flowConfirms) {
      rejections.push({
        timestamp: now,
        reason: 'Flow not aligned with structure — analytical output rejected',
        ruleNumber: 27,
        module: 'Decision',
      });
      trace.push({ stage: 'Flow', status: 'FAIL', detail: 'flowAlign=false and flowScore≤0', timestamp: now });
      return this.buildOutput(
        DECISION.NO_TRADE,
        STRENGTH.VERY_LOW,
        null,
        rangeOutput?.tradeZone || TRADE_ZONE.NO_TRADE,
        rangeOutput,
        health,
        Math.min(scanner.winProb, 40),
        'Flow does not confirm OI/gamma structure',
        rejections,
        trace,
        false,
        null
      );
    }

    const tradeZone = rangeOutput?.tradeZone || TRADE_ZONE.NO_TRADE;
    trace.push({ stage: 'Range', status: tradeZone === TRADE_ZONE.NO_TRADE ? 'FAIL' : 'PASS', detail: `TradeZone=${tradeZone}`, timestamp: now });

    // Trade Zone is master for execution; log high analytical confidence blocked by zone
    if (tradeZone === TRADE_ZONE.NO_TRADE) {
      rejections.push({ timestamp: now, reason: 'Trade Zone is NO_TRADE (master gate)', ruleNumber: 23, module: 'Range' });
    }

    // Unified confidence score (merged former verification / soft filters / probability)
    let confidenceScore = scanner.winProb;

    if (scanner.overlap < 60) confidenceScore -= 10;
    if (scanner.delta === 'NEUTRAL') confidenceScore -= 5;
    if (scanner.flowScore <= 0) confidenceScore -= 5;

    if (scanner.indexDirection === 'NEUTRAL' && scanner.flowScore <= 0) {
      confidenceScore -= 15;
      trace.push({ stage: 'MarketContext', status: 'FAIL', detail: 'Neutral index + weak flow — confidence reduced', timestamp: now });
    }

    // Latency / integrity: reduce confidence instead of forcing NO_TRADE
    const maxLat = configManager.getSection('health').maxLatencyMs;
    if (health.latencyMs > maxLat) {
      confidenceScore -= 20;
      rejections.push({ timestamp: now, reason: 'High latency — confidence reduced', ruleNumber: 25, module: 'Health' });
      trace.push({ stage: 'DataQuality', status: 'FAIL', detail: `Latency ${health.latencyMs}ms`, timestamp: now });
    }
    if (health.dataIntegrity === 'CORRUPT') {
      confidenceScore -= 25;
      rejections.push({ timestamp: now, reason: 'Data integrity issue — confidence reduced', ruleNumber: 25, module: 'Health' });
    }

    if (health.systemMode === HEALTH_MODE.CAUTION) confidenceScore -= 5;
    if (health.systemMode === HEALTH_MODE.RESTRICTED) confidenceScore -= 15;

    // Strict HTF ≠ MTF → no simulated trade path (analytical direction may still show)
    let mtfExecutionBlocked = false;
    if (!tfAligned(scanner.htfDirection, scanner.mtfDirection)) {
      mtfExecutionBlocked = true;
      confidenceScore -= 25;
      rejections.push({ timestamp: now, reason: 'HTF ≠ MTF — execution rejected (strict)', ruleNumber: 26, module: 'Timeframe' });
      trace.push({ stage: 'MTF', status: 'FAIL', detail: 'Higher and middle timeframe mismatch', timestamp: now });
    }

    confidenceScore = Math.max(0, Math.min(100, Math.round(confidenceScore)));

    const strength = strengthFromConfidenceScore(confidenceScore);
    trace.push({ stage: 'Confidence', status: 'PASS', detail: `ConfidenceScore=${confidenceScore}% Strength=${strength} (derived)`, timestamp: now });

    const minConf = configManager.getSection('decision').minProbability;
    if (confidenceScore < minConf) {
      rejections.push({
        timestamp: now,
        reason: `Confidence score ${confidenceScore}% below strict minimum ${minConf}%`,
        ruleNumber: 38,
        module: 'Confidence',
      });
      trace.push({ stage: 'Confidence', status: 'FAIL', detail: `Below ${minConf}%`, timestamp: now });
      return this.buildOutput(
        DECISION.NO_TRADE,
        strength,
        null,
        tradeZone,
        rangeOutput,
        health,
        confidenceScore,
        `Confidence below ${minConf}% — strict reject`,
        rejections,
        trace,
        mtfExecutionBlocked,
        null
      );
    }

    if (tradeZone === TRADE_ZONE.NO_TRADE && confidenceScore >= 70) {
      rejections.push({
        timestamp: now,
        reason: 'High confidence score blocked by Trade Zone (NO_TRADE)',
        ruleNumber: 85,
        module: 'Range',
      });
    }

    let decision: DecisionType;
    let direction: 'BUY' | 'SELL' | null = null;

    if (strength === STRENGTH.VERY_LOW) {
      decision = DECISION.WAIT;
      direction = scanner.signal as 'BUY' | 'SELL';
      trace.push({ stage: 'Final', status: 'PASS', detail: 'Strength VERY_LOW → WAIT', timestamp: now });
    } else if (tradeZone === TRADE_ZONE.WAIT) {
      decision = DECISION.WAIT;
      direction = scanner.signal as 'BUY' | 'SELL';
      trace.push({ stage: 'Final', status: 'PASS', detail: 'Trade Zone WAIT — retest timing only', timestamp: now });
    } else {
      decision = scanner.signal === 'BUY' ? DECISION.BUY : DECISION.SELL;
      direction = scanner.signal as 'BUY' | 'SELL';
      trace.push({ stage: 'Final', status: 'PASS', detail: `Direction=${decision}`, timestamp: now });
    }

    const explanation = this.buildExplanation(decision, strength, confidenceScore, tradeZone, scanner, mtfExecutionBlocked);
    const output = this.buildOutput(
      decision,
      strength,
      direction,
      tradeZone,
      rangeOutput,
      health,
      confidenceScore,
      explanation,
      rejections,
      trace,
      mtfExecutionBlocked,
      direction
    );

    this.lastDecisions.set(symbol, output);
    return output;
  }

  private buildOutput(
    decision: DecisionType,
    strength: StrengthType,
    direction: 'BUY' | 'SELL' | null,
    tradeZone: TradeZoneType,
    rangeOutput: RangeOutput | null,
    healthOutput: HealthOutput | null,
    confidenceScore: number,
    explanation: string,
    rejections: RejectionEntry[],
    trace: PipelineStage[],
    mtfExecutionBlocked: boolean,
    analyticalDirection: 'BUY' | 'SELL' | null
  ): DecisionOutput {
    return {
      decision,
      strength,
      direction,
      tradeZone,
      rangeOutput,
      healthOutput,
      confidenceScore,
      mtfExecutionBlocked,
      analyticalDirection: analyticalDirection ?? direction,
      explanation,
      rejections,
      pipelineTrace: trace,
    };
  }

  private buildExplanation(
    decision: DecisionType,
    strength: StrengthType,
    confidenceScore: number,
    tradeZone: TradeZoneType,
    scanner: ScannerModelOutput,
    mtfBlocked: boolean
  ): string {
    if (decision === DECISION.NO_TRADE) return 'Analytical output blocked — confidence or conditions not met';
    if (decision === DECISION.WAIT) {
      return `WAIT — timing/retest only; confidence ${confidenceScore}%, strength ${strength} (from confidence). Zone=${tradeZone}.`;
    }
    const mtfNote = mtfBlocked ? ' [HTF≠MTF: execution blocked]' : '';
    return `${decision} — Confidence: ${confidenceScore}%, Strength: ${strength} (derived), Zone: ${tradeZone}, Score: ${scanner.entryScore}, RR: ${scanner.rr}${mtfNote}`;
  }

  getLastDecision(symbol: string): DecisionOutput | null {
    return this.lastDecisions.get(symbol) || null;
  }

  clear(): void {
    this.lastDecisions.clear();
  }
}

export const decisionEngine = new DecisionEngine();
