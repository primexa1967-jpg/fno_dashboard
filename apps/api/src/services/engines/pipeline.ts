/**
 * Pipeline Orchestrator — Full Execution Pipeline
 *
 * Spec: §63-63A, §131-143, §220-231 (Final Pipeline Flow)
 *
 * Sequence: Data → Health → Scanner → Range → Decision → Probability →
 *           Trigger → Timeframe → Risk → Entry → Execution → Exit
 *
 * §52A: Range logic only in rangeEngine.
 * §52B: No module outside rangeEngine modifies Trade Zone.
 * §144-145: One active cycle per instrument. No overlapping.
 */

import { healthEngine } from './healthEngine';
import { computeRange, classifyPosition, calculateOverlap, type computeGlobal } from './rangeEngine';
import { decisionEngine, type ScannerSignal } from './decisionEngine';
import { triggerEngine, type TriggerContext } from './triggerEngine';
import { riskEngine } from './riskEngine';
import { entryEngine, type EntryContext } from './entryEngine';
import { simulationEngine } from './simulationEngine';
import { configManager } from './configManager';
import { evaluateProbabilityGate } from '../probabilityService';

import {
  POSITION, TRADE_ZONE, DECISION, HEALTH_MODE, SYSTEM_STATE,
  TRADE_CLASSIFICATION,
  type RangeEngineInput, type RangeOutput, type HealthOutput,
  type DecisionOutput, type TriggerOutput, type RiskOutput, type EntryOutput,
  type PipelineStage, type RejectionEntry, type TradeObject,
} from './constants';

// ─────────────────────────────────────────────────────────────
//  PIPELINE RESULT
// ─────────────────────────────────────────────────────────────

export interface PipelineResult {
  symbol: string;
  timestamp: number;
  health: HealthOutput;
  rangeOutput: RangeOutput | null;
  decision: DecisionOutput | null;
  trigger: TriggerOutput | null;
  risk: RiskOutput | null;
  entry: EntryOutput | null;
  trade: TradeObject | null;
  pipelineTrace: PipelineStage[];
  rejections: RejectionEntry[];
  /** Final consolidated analytical output (direction + zone + gates). */
  finalConsolidatedOutput: 'BUY' | 'SELL' | 'NONE';
  /** Same as finalConsolidatedOutput (legacy field name). */
  finalSignal: 'BUY' | 'SELL' | 'NONE';
  finalDecision: 'TRADE' | 'NO_TRADE' | 'WAIT';
}

// ─────────────────────────────────────────────────────────────
//  MARKET DATA INTERFACE (from existing services)
// ─────────────────────────────────────────────────────────────

export interface MarketDataSnapshot {
  symbol: string;
  spotPrice: number;

  // ATR / Range data (from marketRangeService)
  atrHigh: number;
  atrLow: number;
  emHigh: number;
  emLow: number;
  atrWidth: number;
  emWidth: number;

  // Scanner signal (from existing scannerEngine)
  scannerSignal: ScannerSignal | null;

  // Trigger context
  triggerData: Partial<TriggerContext>;

  // Entry data
  spread: number;
  volume: number;
  openInterest: number;
  volatility: number;
  ltfCandleClosed: boolean;
  breakoutCandleSize: number;
  averageCandleSize: number;

  // Trade params
  strike: number;
  optionType: 'CE' | 'PE';
  stopLoss: number;
  target: number;

  // Context
  vix: number;
  vwap: number;
  gamma: string;
  timeStrength: string;
  marketState: string;
  iv: number;

  /** Option premium (LTP) for sizing and simulated entry — index spot stays in spotPrice */
  optionEntryPrice: number;
  /** For historical win-rate gate */
  setupType?: string;
}

// ─────────────────────────────────────────────────────────────
//  ACTIVE CYCLE TRACKING (§144-145)
// ─────────────────────────────────────────────────────────────

const activeCycles = new Set<string>();

// ─────────────────────────────────────────────────────────────
//  PIPELINE ORCHESTRATOR
// ─────────────────────────────────────────────────────────────

class PipelineOrchestrator {

  /**
   * Run the full pipeline for a single instrument.
   * §144: Only one active execution cycle per instrument.
   */
  async runPipeline(data: MarketDataSnapshot): Promise<PipelineResult> {
    const trace: PipelineStage[] = [];
    const rejections: RejectionEntry[] = [];
    const now = Date.now();

    const result: PipelineResult = {
      symbol: data.symbol,
      timestamp: now,
      health: null as any,
      rangeOutput: null,
      decision: null,
      trigger: null,
      risk: null,
      entry: null,
      trade: null,
      pipelineTrace: trace,
      rejections,
      finalConsolidatedOutput: 'NONE',
      finalSignal: 'NONE',
      finalDecision: 'NO_TRADE',
    };

    // §145: No overlapping cycles
    if (activeCycles.has(data.symbol)) {
      trace.push({ stage: 'Pipeline', status: 'SKIP', detail: 'Cycle already active for this instrument', timestamp: now });
      return result;
    }

    activeCycles.add(data.symbol);

    try {
      // ─── STAGE 1: HEALTH (highest priority, §181) ───────
      const health = healthEngine.evaluate({ vix: data.vix });
      result.health = health;
      trace.push({ stage: 'Health', status: health.systemState === SYSTEM_STATE.ACTIVE ? 'PASS' : 'FAIL', detail: `Score=${health.healthScore} Mode=${health.systemMode}`, timestamp: now });

      if (health.systemState === SYSTEM_STATE.HALTED || health.systemMode === HEALTH_MODE.HALT) {
        rejections.push({ timestamp: now, reason: 'System HALTED', ruleNumber: 1, module: 'Health' });
        result.finalDecision = 'NO_TRADE';
        return result;
      }

      // ─── STAGE 2: SCANNER (from existing engine) ────────
      if (!data.scannerSignal || data.scannerSignal.signal === 'NONE') {
        trace.push({ stage: 'Scanner', status: 'FAIL', detail: 'No valid scanner signal', timestamp: now });
        rejections.push({ timestamp: now, reason: 'No scanner signal', ruleNumber: 7, module: 'Scanner' });
        result.finalDecision = 'NO_TRADE';
        return result;
      }
      trace.push({ stage: 'Scanner', status: 'PASS', detail: `ModelOutput=${data.scannerSignal.signal}`, timestamp: now });

      // ─── STAGE 3: RANGE ENGINE ──────────────────────────
      const atrPos = classifyPosition(data.spotPrice, data.atrHigh, data.atrLow);
      const emPos = classifyPosition(data.spotPrice, data.emHigh, data.emLow);
      const overlap = calculateOverlap(data.atrHigh, data.atrLow, data.emHigh, data.emLow);

      const rangeInput: RangeEngineInput = {
        atrPosition: atrPos,
        emPosition: emPos,
        overlap,
        atrWidth: data.atrWidth,
        emWidth: data.emWidth,
        rangeType: 'DAILY',
        spotPrice: data.spotPrice,
      };

      const rangeOutput = computeRange(rangeInput);
      result.rangeOutput = rangeOutput;
      trace.push({ stage: 'Range', status: rangeOutput.tradeZone === TRADE_ZONE.NO_TRADE ? 'FAIL' : 'PASS', detail: `TradeZone=${rangeOutput.tradeZone} Market=${rangeOutput.marketZone}`, timestamp: now });

      // ─── STAGE 4: DECISION ENGINE ───────────────────────
      const decision = decisionEngine.evaluate(data.symbol, data.scannerSignal, rangeOutput, health, { vix: data.vix });
      result.decision = decision;
      trace.push({
        stage: 'Decision',
        status: decision.decision === DECISION.NO_TRADE ? 'FAIL' : 'PASS',
        detail: `Direction=${decision.decision} Strength=${decision.strength}(from score) Score=${decision.confidenceScore}`,
        timestamp: now,
      });

      if (decision.decision === DECISION.NO_TRADE) {
        rejections.push(...decision.rejections);
        result.finalDecision = 'NO_TRADE';
        return result;
      }

      if (decision.decision === DECISION.WAIT) {
        result.finalDecision = 'WAIT';
      }

      if (decision.mtfExecutionBlocked) {
        rejections.push({
          timestamp: now,
          reason: 'HTF ≠ MTF — consolidated output blocks simulated execution',
          ruleNumber: 26,
          module: 'Pipeline',
        });
        trace.push({ stage: 'Pipeline', status: 'FAIL', detail: 'MTF mismatch — no simulated trade', timestamp: now });
        result.finalDecision = 'NO_TRADE';
        return result;
      }

      // ─── STAGE 4B: PROBABILITY (historical win rate by setup) ────────────
      const prob = evaluateProbabilityGate(data.symbol, data.setupType);
      trace.push({
        stage: 'Probability',
        status: prob.allowed ? 'PASS' : 'FAIL',
        detail: prob.reason,
        timestamp: now,
      });
      if (!prob.allowed) {
        rejections.push({
          timestamp: now,
          reason: prob.reason,
          ruleNumber: 210,
          module: 'Probability',
        });
        simulationEngine.logRejection({
          timestamp: now,
          reason: prob.reason,
          ruleNumber: 210,
          module: 'Probability',
        });
        result.finalDecision = 'NO_TRADE';
        return result;
      }

      // ─── STAGE 5: TRIGGER ENGINE (timing only; direction from decision) ───
      const triggerCtx: TriggerContext = {
        decision: decision.decision,
        analyticalDirection: decision.analyticalDirection,
        tradeZone: rangeOutput.tradeZone,
        price: data.spotPrice,
        gammaWall: data.triggerData?.gammaWall || 0,
        gammaWallBroken: data.triggerData?.gammaWallBroken || false,
        gammaFlipDetected: data.triggerData?.gammaFlipDetected || false,
        flowScore: data.scannerSignal.flowScore,
        flowDirection: data.scannerSignal.flowAlign ? (data.scannerSignal.signal as any) : 'NEUTRAL',
        momentumSpike: data.triggerData?.momentumSpike || false,
        volumeSurge: data.triggerData?.volumeSurge || false,
        htfDirection: data.scannerSignal.htfDirection,
        priceRetesting: data.triggerData?.priceRetesting || false,
        levelHolding: data.triggerData?.levelHolding || false,
        retestLevel: data.triggerData?.retestLevel || 0,
        structureBreak: data.triggerData?.structureBreak || false,
        breakoutClosed: data.triggerData?.breakoutClosed || false,
        breakoutCandleSize: data.breakoutCandleSize,
        averageCandleSize: data.averageCandleSize,
        spread: data.spread,
        volume: data.volume,
        latencyMs: health.latencyMs,
      };

      const trigger = triggerEngine.evaluate(triggerCtx);
      result.trigger = trigger;
      trace.push({ stage: 'Trigger', status: trigger.triggered ? 'PASS' : 'FAIL', detail: `Triggered=${trigger.triggered} Type=${trigger.triggerType}`, timestamp: now });

      if (!trigger.triggered) {
        rejections.push({ timestamp: now, reason: trigger.details, ruleNumber: 44, module: 'Trigger' });
        return result;
      }

      // ─── STAGE 6: RISK ENGINE ──────────────────────────
      const entryPx = data.optionEntryPrice > 0 ? data.optionEntryPrice : data.spotPrice;
      const slDistance = Math.max(Math.abs(entryPx - data.stopLoss), entryPx * 0.08, 0.05);
      const riskResult = riskEngine.evaluate(
        data.symbol,
        slDistance,
        rangeOutput.confidenceZone,
        overlap,
        decision.confidenceScore,
        data.optionType,
        data.volatility > 25,
        decision.strength
      );
      result.risk = riskResult;
      trace.push({ stage: 'Risk', status: riskResult.allowed ? 'PASS' : 'FAIL', detail: `Allowed=${riskResult.allowed} Size=${riskResult.positionSize}`, timestamp: now });

      if (!riskResult.allowed) {
        rejections.push({ timestamp: now, reason: riskResult.reason, ruleNumber: 125, module: 'Risk' });
        return result;
      }

      // ─── STAGE 7: ENTRY ENGINE ─────────────────────────
      const entryCtx: EntryContext = {
        decision,
        trigger,
        risk: riskResult,
        health,
        spread: data.spread,
        volume: data.volume,
        openInterest: data.openInterest,
        volatility: data.volatility,
        ltfCandleClosed: data.ltfCandleClosed,
        breakoutCandleSize: data.breakoutCandleSize,
        averageCandleSize: data.averageCandleSize,
      };

      const entry = entryEngine.evaluate(entryCtx);
      result.entry = entry;
      trace.push({ stage: 'Entry', status: entry.allowed ? 'PASS' : 'FAIL', detail: `Allowed=${entry.allowed} Type=${entry.entryType}`, timestamp: now });

      if (!entry.allowed) {
        rejections.push({ timestamp: now, reason: entry.reason, ruleNumber: 87, module: 'Entry' });
        simulationEngine.logRejection({ timestamp: now, reason: entry.reason, ruleNumber: 87, module: 'Entry' });
        return result;
      }

      // ─── STAGE 8: EXECUTION (Simulation) ────────────────
      const trade = simulationEngine.createTrade({
        symbol: data.symbol,
        direction: (decision.direction as 'BUY' | 'SELL') || 'BUY',
        optionType: data.optionType,
        strike: data.strike,
        entryPrice: entryPx,
        quantity: riskResult.positionSize,
        stopLoss: data.stopLoss,
        target: data.target,
        confidenceScore: decision.confidenceScore,
        strength: decision.strength,
        confidence: rangeOutput.confidenceZone,
        tradeZone: rangeOutput.tradeZone,
        triggerType: trigger.triggerType,
        tradeType: TRADE_CLASSIFICATION.BREAKOUT, // simplified
        setupType: data.setupType,
        context: {
          vix: data.vix,
          vwap: data.vwap,
          gamma: data.gamma,
          timeStrength: data.timeStrength,
          marketState: data.marketState,
          flowScore: data.scannerSignal.flowScore,
          iv: data.iv,
          overlap,
        },
      });

      result.trade = trade;
      const out = decision.direction as 'BUY' | 'SELL';
      result.finalConsolidatedOutput = out;
      result.finalSignal = out;
      result.finalDecision = 'TRADE';
      trace.push({
        stage: 'Simulation',
        status: trade ? 'PASS' : 'FAIL',
        detail: trade ? `Simulated trade ${trade.tradeId} opened` : 'Simulation failed',
        timestamp: now,
      });

    } finally {
      activeCycles.delete(data.symbol);
    }

    return result;
  }

  /**
   * Run exit check cycle for all open trades.
   * §142: Monitor exit engine continuously.
   */
  async runExitCycle(): Promise<void> {
    const exits = simulationEngine.checkExits();
    for (const { tradeId, reason } of exits) {
      const trade = simulationEngine.getOpenTrades().find(t => t.tradeId === tradeId);
      if (trade) {
        simulationEngine.closeTrade(tradeId, trade.currentPrice, reason);
      }
    }
  }

  /**
   * Get pipeline summary for a symbol (for UI display).
   */
  getPipelineSummary(symbol: string): any {
    const decision = decisionEngine.getLastDecision(symbol);
    const health = healthEngine.evaluate();
    const account = riskEngine.getAccount();
    const openTrades = simulationEngine.getOpenTrades().filter(t => t.symbol === symbol);

    return {
      symbol,
      health: {
        score: health.healthScore,
        mode: health.systemMode,
        state: health.systemState,
      },
      decision: decision ? {
        decision: decision.decision,
        strength: decision.strength,
        confidenceScore: decision.confidenceScore,
        tradeZone: decision.tradeZone,
        analyticalDirection: decision.analyticalDirection,
        mtfExecutionBlocked: decision.mtfExecutionBlocked,
      } : null,
      rangeOutput: decision?.rangeOutput || null,
      account: {
        balance: account.accountBalance,
        available: account.availableCapital,
        dailyPnl: account.dailyPnl,
      },
      activeTrades: openTrades.length,
      timestamp: Date.now(),
    };
  }
}

export const pipelineOrchestrator = new PipelineOrchestrator();
