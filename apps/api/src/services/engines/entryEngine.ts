/**
 * Entry Engine — Final Entry Gate
 *
 * Spec: §60-62B, §68-87 (Entry Engine)
 * Validates all conditions before simulated trade creation.
 *
 * Pipeline: ... → Risk → **Entry** → Execution → Exit
 */

import {
  TRADE_ZONE, DECISION, ORDER_TYPE, TRIGGER_TYPE,
  type TradeZoneType, type DecisionType, type OrderTypeValue,
  type EntryOutput, type DecisionOutput, type TriggerOutput, type RiskOutput,
  type HealthOutput, HEALTH_MODE,
} from './constants';
import { configManager } from './configManager';
import { healthEngine } from './healthEngine';

// ─────────────────────────────────────────────────────────────
//  ENTRY CONTEXT
// ─────────────────────────────────────────────────────────────

export interface EntryContext {
  decision: DecisionOutput;
  trigger: TriggerOutput;
  risk: RiskOutput;
  health: HealthOutput;

  // Market data for entry validation
  spread: number;
  volume: number;
  openInterest: number;
  volatility: number;
  ltfCandleClosed: boolean;     // §72: Entry only after LTF candle close
  breakoutCandleSize: number;
  averageCandleSize: number;
}

// ─────────────────────────────────────────────────────────────
//  ENTRY ENGINE
// ─────────────────────────────────────────────────────────────

class EntryEngine {
  private consecutiveFailures: number = 0;
  private rejectionLog: Array<{ timestamp: number; reason: string; ruleNumber: number }> = [];

  /**
   * Validate and determine entry.
   * §62B: Revalidate Trade Zone immediately before execution.
   */
  evaluate(ctx: EntryContext): EntryOutput {
    const cfg = configManager.getSection('entry');

    // Trade Zone = NO_TRADE → master block
    if (ctx.decision.tradeZone === TRADE_ZONE.NO_TRADE) {
      this.logRejection('Trade Zone is NO_TRADE', 60);
      return { allowed: false, orderType: ORDER_TYPE.MARKET, entryType: 'BREAKOUT', reason: 'Trade Zone NO_TRADE — simulated entry blocked', estimatedSlippage: 0 };
    }

    if (!ctx.decision.rangeOutput) {
      this.logRejection('Range output missing', 62);
      return { allowed: false, orderType: ORDER_TYPE.MARKET, entryType: 'BREAKOUT', reason: 'Range output missing — simulated entry blocked', estimatedSlippage: 0 };
    }

    if (ctx.decision.decision !== DECISION.BUY && ctx.decision.decision !== DECISION.SELL) {
      this.logRejection(`Direction is ${ctx.decision.decision}`, 68);
      return { allowed: false, orderType: ORDER_TYPE.MARKET, entryType: 'BREAKOUT', reason: `Direction is ${ctx.decision.decision} — simulated entry blocked`, estimatedSlippage: 0 };
    }

    if (!ctx.trigger.triggered) {
      this.logRejection('No valid trigger', 69);
      return { allowed: false, orderType: ORDER_TYPE.MARKET, entryType: 'BREAKOUT', reason: 'No timing trigger — simulated entry blocked', estimatedSlippage: 0 };
    }

    const minConf = configManager.getSection('decision').minProbability;
    if (ctx.decision.confidenceScore < minConf) {
      this.logRejection(`Confidence score ${ctx.decision.confidenceScore}% below threshold`, 70);
      return { allowed: false, orderType: ORDER_TYPE.MARKET, entryType: 'BREAKOUT', reason: `Confidence score ${ctx.decision.confidenceScore}% < ${minConf}% (strict)`, estimatedSlippage: 0 };
    }

    if (ctx.decision.mtfExecutionBlocked) {
      this.logRejection('HTF MTF mismatch', 71);
      return { allowed: false, orderType: ORDER_TYPE.MARKET, entryType: 'BREAKOUT', reason: 'HTF ≠ MTF — simulated entry blocked', estimatedSlippage: 0 };
    }

    if (!ctx.risk.allowed) {
      this.logRejection(`Risk check failed: ${ctx.risk.reason}`, 125);
      return { allowed: false, orderType: ORDER_TYPE.MARKET, entryType: 'BREAKOUT', reason: ctx.risk.reason, estimatedSlippage: 0 };
    }

    if (ctx.health.systemMode === HEALTH_MODE.HALT) {
      this.logRejection('System health HALT', 133);
      return { allowed: false, orderType: ORDER_TYPE.MARKET, entryType: 'BREAKOUT', reason: 'System health HALT — simulated entry blocked', estimatedSlippage: 0 };
    }

    if (!ctx.ltfCandleClosed) {
      this.logRejection('LTF candle not closed', 72);
      return { allowed: false, orderType: ORDER_TYPE.MARKET, entryType: 'BREAKOUT', reason: 'Waiting for LTF candle close', estimatedSlippage: 0 };
    }

    // §74-75: Spread filter
    if (ctx.spread > cfg.maxSpread) {
      this.logRejection(`Spread ${ctx.spread} > max ${cfg.maxSpread}`, 74);
      return { allowed: false, orderType: ORDER_TYPE.MARKET, entryType: 'BREAKOUT', reason: `Spread too wide for simulate: ${ctx.spread}`, estimatedSlippage: 0 };
    }

    // §76-77: Liquidity filter
    if (ctx.volume < cfg.minVolume) {
      this.logRejection(`Volume ${ctx.volume} < min ${cfg.minVolume}`, 76);
      return { allowed: false, orderType: ORDER_TYPE.MARKET, entryType: 'BREAKOUT', reason: `Volume too low: ${ctx.volume}`, estimatedSlippage: 0 };
    }
    if (ctx.openInterest < cfg.minOI) {
      this.logRejection(`OI ${ctx.openInterest} < min ${cfg.minOI}`, 77);
      return { allowed: false, orderType: ORDER_TYPE.MARKET, entryType: 'BREAKOUT', reason: `Open interest too low: ${ctx.openInterest}`, estimatedSlippage: 0 };
    }

    // §78-79: Slippage control
    const estimatedSlippage = this.estimateSlippage(ctx.spread, ctx.volatility);
    if (estimatedSlippage > cfg.maxSlippage) {
      this.logRejection(`Slippage ${estimatedSlippage.toFixed(2)} > max ${cfg.maxSlippage}`, 79);
      return { allowed: false, orderType: ORDER_TYPE.MARKET, entryType: 'BREAKOUT', reason: `Expected slippage too high: ${estimatedSlippage.toFixed(2)}`, estimatedSlippage };
    }

    // §71: Entry type from trigger
    const entryType = ctx.trigger.triggerType === TRIGGER_TYPE.RETEST ? 'RETEST' as const : 'BREAKOUT' as const;

    // §80-82: Order type control
    let orderType: OrderTypeValue;
    if (ctx.spread > cfg.maxSpread * 0.7) {
      orderType = ORDER_TYPE.LIMIT;  // §82: High spread → LIMIT
    } else if (entryType === 'RETEST') {
      orderType = ORDER_TYPE.LIMIT;  // §81: Retest → LIMIT
    } else {
      orderType = ORDER_TYPE.MARKET; // §80: Breakout → MARKET
    }

    // §73: Breakout candle size check
    if (entryType === 'BREAKOUT' && ctx.breakoutCandleSize > cfg.breakoutCandleSizeMultiplier * ctx.averageCandleSize) {
      this.logRejection('Breakout candle too large — wait for pullback', 73);
      return { allowed: false, orderType, entryType, reason: 'Breakout candle too large — waiting for pullback', estimatedSlippage };
    }

    // §86-87: Consecutive failure tracking
    this.consecutiveFailures = 0; // Reset on successful validation

    return {
      allowed: true,
      orderType,
      entryType,
      reason: `Simulated entry validated: ${entryType} via ${ctx.trigger.triggerType}, order=${orderType}`,
      estimatedSlippage,
    };
  }

  // ─── HELPERS ─────────────────────────────────────────────

  /** §78: Estimate slippage */
  private estimateSlippage(spread: number, volatility: number): number {
    return spread * 0.5 + volatility * 0.01;
  }

  /** Record entry failure */
  recordFailure(): void {
    this.consecutiveFailures++;
  }

  /** §86: Check if we should reduce size due to failures */
  shouldReduceSize(): boolean {
    return this.consecutiveFailures >= configManager.getSection('entry').maxConsecutiveFailures;
  }

  /** Log rejection */
  private logRejection(reason: string, ruleNumber: number): void {
    this.rejectionLog.push({ timestamp: Date.now(), reason, ruleNumber });
    if (this.rejectionLog.length > 200) this.rejectionLog.shift();
    healthEngine.logRejection(reason, ruleNumber);
  }

  /** Get recent rejections */
  getRecentRejections(count: number = 10): typeof this.rejectionLog {
    return this.rejectionLog.slice(-count);
  }
}

export const entryEngine = new EntryEngine();
