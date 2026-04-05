/**
 * Trigger Engine — Trade Trigger Validation
 *
 * Spec: §44-65 (Trigger Engine), §91-94 (Trigger types)
 * Validates: Gamma Break, Flow Dominance, Momentum, Retest, Breakout
 *
 * Pipeline: ... → Decision → Probability → **Trigger** → Risk → Entry
 */

import {
  TRIGGER_TYPE, TRADE_ZONE, DECISION,
  type TriggerTypeValue, type TradeZoneType, type DecisionType,
  type TriggerOutput,
} from './constants';
import { configManager } from './configManager';

// ─────────────────────────────────────────────────────────────
//  TRIGGER CONTEXT (data from other engines)
// ─────────────────────────────────────────────────────────────

export interface TriggerContext {
  // From decision engine
  decision: DecisionType;
  /** BUY/SELL from scanner; set even when decision is WAIT (timing-only). */
  analyticalDirection: 'BUY' | 'SELL' | null;
  tradeZone: TradeZoneType;

  // Price data
  price: number;
  gammaWall: number;
  gammaWallBroken: boolean;
  gammaFlipDetected: boolean;

  // Flow
  flowScore: number;
  flowDirection: 'BUY' | 'SELL' | 'NEUTRAL';

  // Momentum
  momentumSpike: boolean;
  volumeSurge: boolean;
  htfDirection: string;

  // Retest
  priceRetesting: boolean;
  levelHolding: boolean;
  retestLevel: number;

  // Breakout
  structureBreak: boolean;
  breakoutClosed: boolean;
  breakoutCandleSize: number;
  averageCandleSize: number;

  // Validation data
  spread: number;
  volume: number;
  latencyMs: number;
}

// ─────────────────────────────────────────────────────────────
//  TRIGGER ENGINE
// ─────────────────────────────────────────────────────────────

class TriggerEngine {

  /** Flow confirmation: index book uses -2..2 style scores or legacy 0–100; both supported */
  private flowConfirms(ctx: TriggerContext): boolean {
    const fs = ctx.flowScore;
    const thr = configManager.getSection('trigger').flowStrongThreshold;
    if (fs >= 1 || fs <= -1) return true;
    if (fs >= thr) return true;
    return ctx.flowDirection !== 'NEUTRAL' && fs > 0;
  }

  /**
   * Evaluate trigger conditions. Returns triggered=true if any valid trigger found.
   *
   * Index F&O priority: gamma / OI structure → flow → (momentum = timing only) → retest →
   * breakout last (price alone never sufficient).
   */
  evaluate(ctx: TriggerContext): TriggerOutput {
    if (ctx.decision === DECISION.NO_TRADE) {
      return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: `Analytical output is NO_TRADE — no trigger` };
    }
    if (!ctx.analyticalDirection) {
      return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: 'No analytical direction — no trigger' };
    }

    // Trade Zone = NO_TRADE → master gate (no timing trigger)
    if (ctx.tradeZone === TRADE_ZONE.NO_TRADE) {
      return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: 'Trade Zone NO_TRADE blocks trigger' };
    }

    // §56-58: Validation checks
    const cfg = configManager.getSection('trigger');
    if (ctx.spread > cfg.maxSpread) {
      return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: `Spread ${ctx.spread} > max ${cfg.maxSpread}` };
    }
    if (ctx.volume < cfg.minVolume) {
      return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: `Volume ${ctx.volume} < min ${cfg.minVolume}` };
    }
    if (ctx.latencyMs > cfg.maxLatencyMs) {
      return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: `Latency ${ctx.latencyMs}ms > max ${cfg.maxLatencyMs}ms` };
    }

    // Trade Zone = WAIT → timing = retest only
    if (ctx.tradeZone === TRADE_ZONE.WAIT) {
      return this.evaluateRetest(ctx);
    }

    // TRADE zone: direction must be explicit BUY/SELL for momentum/breakout path
    if (ctx.decision !== DECISION.BUY && ctx.decision !== DECISION.SELL) {
      return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: `Decision is ${ctx.decision} — awaiting timing in TRADE zone` };
    }

    // Priority 1: GAMMA BREAK
    const gamma = this.evaluateGammaBreak(ctx);
    if (gamma.triggered) return gamma;

    // Priority 2: FLOW DOMINANCE (confirms structure)
    const flow = this.evaluateFlowDominance(ctx);
    if (flow.triggered) return flow;

    // Priority 3: MOMENTUM (only after flow/gamma context — see evaluateMomentum)
    const momentum = this.evaluateMomentum(ctx);
    if (momentum.triggered) return momentum;

    // Priority 4: RETEST at key levels (before raw price breakout)
    const retest = this.evaluateRetest(ctx);
    if (retest.triggered) return retest;

    // Priority 5: BREAKOUT — last resort; never price-only
    const breakout = this.evaluateBreakout(ctx);
    if (breakout.triggered) return breakout;

    // §64: No valid trigger → FALSE
    return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: 'No valid trigger conditions met' };
  }

  // ─── INDIVIDUAL TRIGGER EVALUATIONS ──────────────────────

  /** §50-51: Gamma Break */
  private evaluateGammaBreak(ctx: TriggerContext): TriggerOutput {
    // §50: Price breaks high OI zone with volume spike → IMMEDIATE TRIGGER
    if (ctx.gammaWallBroken && ctx.volumeSurge) {
      return {
        triggered: true,
        triggerType: TRIGGER_TYPE.GAMMA_BREAK,
        priority: 1,
        details: `High OI zone broken at ${ctx.gammaWall} with volume surge`,
      };
    }
    // §51: Gamma flip detected → REVERSAL ENTRY
    if (ctx.gammaFlipDetected) {
      return {
        triggered: true,
        triggerType: TRIGGER_TYPE.GAMMA_BREAK,
        priority: 1,
        details: 'Gamma flip detected — reversal trigger',
      };
    }
    return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: '' };
  }

  /** §49: Flow Dominance */
  private evaluateFlowDominance(ctx: TriggerContext): TriggerOutput {
    const cfg = configManager.getSection('trigger');
    if (
      ctx.flowDirection !== 'NEUTRAL' &&
      ctx.analyticalDirection &&
      ctx.flowDirection !== ctx.analyticalDirection
    ) {
      return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: '' };
    }
    if (
      (ctx.flowScore >= cfg.flowStrongThreshold || ctx.flowScore >= 1 || ctx.flowScore <= -1) &&
      (ctx.flowDirection === 'BUY' || ctx.flowDirection === 'SELL')
    ) {
      return {
        triggered: true,
        triggerType: TRIGGER_TYPE.FLOW_DOMINANCE,
        priority: 2,
        details: `Flow dominance: score=${ctx.flowScore} direction=${ctx.flowDirection}`,
      };
    }
    return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: '' };
  }

  /** §52: Momentum — timing only; requires gamma break, flow, or flip first */
  private evaluateMomentum(ctx: TriggerContext): TriggerOutput {
    const structural =
      ctx.gammaWallBroken || ctx.gammaFlipDetected || this.flowConfirms(ctx);
    if (!structural) {
      return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: 'Momentum without OI/gamma/flow context — skipped' };
    }
    if (ctx.momentumSpike && ctx.volumeSurge) {
      const dirMatch = (ctx.htfDirection === 'BULLISH' && ctx.analyticalDirection === 'BUY' && ctx.flowDirection === 'BUY') ||
                        (ctx.htfDirection === 'BEARISH' && ctx.analyticalDirection === 'SELL' && ctx.flowDirection === 'SELL');
      if (dirMatch) {
        return {
          triggered: true,
          triggerType: TRIGGER_TYPE.MOMENTUM,
          priority: 3,
          details: `Momentum spike + volume surge aligned with HTF ${ctx.htfDirection}`,
        };
      }
    }
    return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: '' };
  }

  /** §53: Retest */
  private evaluateRetest(ctx: TriggerContext): TriggerOutput {
    const ad = ctx.analyticalDirection;
    if (!ad) return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: '' };

    // Retest only if trend intact (aligned with analytical direction)
    const trendOk =
      (ad === 'BUY' && ctx.htfDirection === 'BULLISH') ||
      (ad === 'SELL' && ctx.htfDirection === 'BEARISH');
    if (!trendOk) {
      return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: 'Retest skipped — trend not intact vs direction' };
    }

    if (ctx.priceRetesting && ctx.levelHolding) {
      return {
        triggered: true,
        triggerType: TRIGGER_TYPE.RETEST,
        priority: 5,
        details: `Price retesting level ${ctx.retestLevel} and holding`,
      };
    }
    return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: '' };
  }

  /** §54-55: Breakout — entry timing only; blocked unless gamma or flow already validates */
  private evaluateBreakout(ctx: TriggerContext): TriggerOutput {
    const ad = ctx.analyticalDirection;
    if (!ctx.structureBreak || !ctx.breakoutClosed || !ctx.volumeSurge) {
      return { triggered: false, triggerType: TRIGGER_TYPE.NONE, priority: 0, details: '' };
    }
    if (!ctx.gammaWallBroken && !ctx.gammaFlipDetected && !this.flowConfirms(ctx)) {
      return {
        triggered: false,
        triggerType: TRIGGER_TYPE.NONE,
        priority: 0,
        details: 'Price/candle breakout alone blocked — need gamma or flow confirmation',
      };
    }

    const trendAligned =
      (ad === 'BUY' && ctx.htfDirection === 'BULLISH') ||
      (ad === 'SELL' && ctx.htfDirection === 'BEARISH');
    if (!trendAligned) {
      return {
        triggered: false,
        triggerType: TRIGGER_TYPE.BREAKOUT,
        priority: 4,
        details: 'Breakout requires trend alignment with analytical direction + volume',
      };
    }

    const cfg = configManager.getSection('entry');
    if (ctx.breakoutCandleSize > cfg.breakoutCandleSizeMultiplier * ctx.averageCandleSize) {
      return {
        triggered: false,
        triggerType: TRIGGER_TYPE.BREAKOUT,
        priority: 4,
        details: 'Breakout candle too large — wait for pullback',
      };
    }
    return {
      triggered: true,
      triggerType: TRIGGER_TYPE.BREAKOUT,
      priority: 4,
      details: 'Structure break + close + volume, trend aligned',
    };
  }
}

export const triggerEngine = new TriggerEngine();
