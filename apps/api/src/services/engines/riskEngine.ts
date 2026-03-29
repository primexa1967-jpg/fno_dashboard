/**
 * Risk Engine — Capital + Survival Control
 *
 * Spec: §125-127A (Risk), §182-219 (Risk Engine), §251-253 (Capital)
 * Overrides all engines except Health (§218-219).
 *
 * Pipeline: ... → Trigger → Timeframe → **Risk Engine** → Entry → Execution
 */

import {
  STRENGTH, CONFIDENCE_ZONE,
  type StrengthType, type ConfidenceZoneType,
  type RiskOutput, type SimulationAccount,
} from './constants';
import { configManager } from './configManager';

// ─────────────────────────────────────────────────────────────
//  INTERNAL STATE
// ─────────────────────────────────────────────────────────────

interface RiskState {
  accountBalance: number;
  availableCapital: number;
  usedCapital: number;
  dailyPnl: number;
  totalPnl: number;
  openCEPositions: number;
  openPEPositions: number;
  totalOpenPositions: number;
  consecutiveLosses: number;
  dailyTradeCount: number;
  lastTradeTime: number;
  lastLossTime: number;
  halted: boolean;
  haltReason: string;
}

// ─────────────────────────────────────────────────────────────
//  RISK ENGINE
// ─────────────────────────────────────────────────────────────

class RiskEngine {
  private state: RiskState;
  private symbolConsecutiveLosses: Map<string, number> = new Map();

  constructor() {
    const cfg = configManager.getSection('simulation');
    this.state = {
      accountBalance: cfg.initialCapital,
      availableCapital: cfg.initialCapital,
      usedCapital: 0,
      dailyPnl: 0,
      totalPnl: 0,
      openCEPositions: 0,
      openPEPositions: 0,
      totalOpenPositions: 0,
      consecutiveLosses: 0,
      dailyTradeCount: 0,
      lastTradeTime: 0,
      lastLossTime: 0,
      halted: false,
      haltReason: '',
    };
  }

  // ─── EVALUATION (§218-219) ────────────────────────────────

  /**
   * Validate if a trade is allowed under current risk constraints.
   * Returns RiskOutput with allowed=true/false and position sizing.
   */
  evaluate(
    symbol: string,
    stopLossDistance: number,
    confidence: ConfidenceZoneType,
    _overlap: number,
    confidenceScore: number,
    optionType: 'CE' | 'PE',
    volatilityHigh: boolean = false,
    strength: StrengthType
  ): RiskOutput {
    const cfg = configManager.getSection('risk');
    const symKey = symbol.toUpperCase();

    // §207-209: Kill switch checks
    if (this.state.halted) {
      return { allowed: false, positionSize: 0, riskAmount: 0, capitalAllocated: 0, reason: `System halted: ${this.state.haltReason}` };
    }

    const symLosses = this.symbolConsecutiveLosses.get(symKey) || 0;
    if (symLosses >= cfg.symbolConsecutiveLossPause) {
      return {
        allowed: false,
        positionSize: 0,
        riskAmount: 0,
        capitalAllocated: 0,
        reason: `${symLosses} consecutive losses on ${symKey} — paused`,
      };
    }

    // §199-200: Daily loss limit
    if (this.state.dailyPnl / this.state.accountBalance <= cfg.dailyLossLimit) {
      this.state.halted = true;
      this.state.haltReason = 'Daily loss limit exceeded';
      return { allowed: false, positionSize: 0, riskAmount: 0, capitalAllocated: 0, reason: `Daily loss ${(this.state.dailyPnl / this.state.accountBalance * 100).toFixed(1)}% exceeds limit` };
    }

    // §207: Account drawdown halt
    const drawdown = this.state.totalPnl / this.state.accountBalance;
    if (drawdown <= cfg.accountDrawdownHalt) {
      this.state.halted = true;
      this.state.haltReason = 'Account drawdown exceeded';
      return { allowed: false, positionSize: 0, riskAmount: 0, capitalAllocated: 0, reason: `Account drawdown ${(drawdown * 100).toFixed(1)}% exceeds limit` };
    }

    // §201-203: Consecutive loss checks
    if (this.state.consecutiveLosses >= cfg.lossStreakHaltAt) {
      this.state.halted = true;
      this.state.haltReason = 'Consecutive loss streak halt';
      return { allowed: false, positionSize: 0, riskAmount: 0, capitalAllocated: 0, reason: `${this.state.consecutiveLosses} consecutive losses — halted` };
    }

    // §211: Cooldown check
    const cooldownMs = cfg.cooldownMinutes * 60 * 1000;
    if (this.state.lastLossTime > 0 && Date.now() - this.state.lastLossTime < cooldownMs) {
      return { allowed: false, positionSize: 0, riskAmount: 0, capitalAllocated: 0, reason: 'Cooldown period active after loss' };
    }

    // §88-90: Position limits
    if (optionType === 'CE' && this.state.openCEPositions >= cfg.maxCEPositions) {
      return { allowed: false, positionSize: 0, riskAmount: 0, capitalAllocated: 0, reason: `Max CE positions (${cfg.maxCEPositions}) reached` };
    }
    if (optionType === 'PE' && this.state.openPEPositions >= cfg.maxPEPositions) {
      return { allowed: false, positionSize: 0, riskAmount: 0, capitalAllocated: 0, reason: `Max PE positions (${cfg.maxPEPositions}) reached` };
    }
    if (this.state.totalOpenPositions >= cfg.maxTotalPositions) {
      return { allowed: false, positionSize: 0, riskAmount: 0, capitalAllocated: 0, reason: `Max total positions (${cfg.maxTotalPositions}) reached` };
    }

    // §91: Capital exposure check
    if (this.state.usedCapital / this.state.accountBalance >= cfg.maxCapitalExposure) {
      return { allowed: false, positionSize: 0, riskAmount: 0, capitalAllocated: 0, reason: `Max capital exposure (${cfg.maxCapitalExposure * 100}%) reached` };
    }

    // ─── POSITION SIZING (§182-190) ────────────────────────

    // §182-184: Risk per trade
    let riskPerTrade = cfg.riskPerTrade;

    // §204-206: Profit protection
    if (this.state.dailyPnl / this.state.accountBalance >= cfg.profitReduceRisk) {
      riskPerTrade *= 0.5; // Reduce risk after good profits
    }

    // §202: Loss streak → reduce size by 50%
    if (this.state.consecutiveLosses >= cfg.lossStreakReduceAt) {
      riskPerTrade *= 0.5;
    }

    const riskAmount = this.state.accountBalance * riskPerTrade;

    // §185-186: Position size from stop loss
    let positionSize = stopLossDistance > 0 ? Math.floor(riskAmount / stopLossDistance) : 0;
    if (positionSize <= 0) {
      return { allowed: false, positionSize: 0, riskAmount, capitalAllocated: 0, reason: 'Invalid stop loss distance — cannot size position' };
    }

    // §187: High volatility → reduce size
    if (volatilityHigh) positionSize = Math.floor(positionSize * 0.7);

    // Range confidence zone (market context) — sizing layer
    switch (confidence) {
      case CONFIDENCE_ZONE.HIGH: break;
      case CONFIDENCE_ZONE.MEDIUM: positionSize = Math.floor(positionSize * 0.75); break;
      case CONFIDENCE_ZONE.LOW: positionSize = Math.floor(positionSize * 0.5); break;
      case CONFIDENCE_ZONE.VERY_LOW: positionSize = Math.floor(positionSize * 0.25); break;
    }

    // Strength from confidence score: HIGH full, MED 70%, LOW 50%
    let strengthMult = 1;
    if (strength === STRENGTH.MEDIUM) strengthMult = 0.7;
    else if (strength === STRENGTH.LOW) strengthMult = 0.5;
    else if (strength === STRENGTH.VERY_LOW) strengthMult = 0.25;
    positionSize = Math.max(1, Math.floor(positionSize * strengthMult));

    // Confidence score also ranks/filter sizes marginally (no hard block here — entry gate handles min)
    if (confidenceScore < 65) {
      positionSize = Math.max(1, Math.floor(positionSize * 0.85));
    }

    positionSize = Math.max(1, positionSize);

    // §193: Check available capital
    const capitalNeeded = positionSize * stopLossDistance * 3; // rough margin estimate
    if (capitalNeeded > this.state.availableCapital) {
      positionSize = Math.max(1, Math.floor(this.state.availableCapital / (stopLossDistance * 3)));
    }

    const capitalAllocated = positionSize * stopLossDistance * 3;

    return {
      allowed: true,
      positionSize,
      riskAmount,
      capitalAllocated,
      reason: `Simulated position sized: ${positionSize} lots, risk=${riskAmount.toFixed(0)}, zone=${confidence}, strength=${strength}`,
    };
  }

  // ─── CAPITAL MANAGEMENT (§191-194, §232-246) ──────────────

  /** Lock capital for a trade (§191-192) */
  allocateCapital(amount: number, optionType: 'CE' | 'PE'): void {
    this.state.usedCapital += amount;
    this.state.availableCapital -= amount;
    this.state.totalOpenPositions++;
    if (optionType === 'CE') this.state.openCEPositions++;
    else this.state.openPEPositions++;
    this.state.lastTradeTime = Date.now();
    this.state.dailyTradeCount++;
  }

  /** Release capital after trade exit (§194) */
  releaseCapital(amount: number, pnl: number, optionType: 'CE' | 'PE', symbol?: string): void {
    this.state.usedCapital -= amount;
    this.state.availableCapital += amount + pnl;
    this.state.accountBalance += pnl;
    this.state.dailyPnl += pnl;
    this.state.totalPnl += pnl;
    this.state.totalOpenPositions = Math.max(0, this.state.totalOpenPositions - 1);
    if (optionType === 'CE') this.state.openCEPositions = Math.max(0, this.state.openCEPositions - 1);
    else this.state.openPEPositions = Math.max(0, this.state.openPEPositions - 1);

    if (pnl < 0) {
      this.state.consecutiveLosses++;
      this.state.lastLossTime = Date.now();
      if (symbol) {
        const k = symbol.toUpperCase();
        this.symbolConsecutiveLosses.set(k, (this.symbolConsecutiveLosses.get(k) || 0) + 1);
      }
    } else {
      this.state.consecutiveLosses = 0;
      if (symbol) {
        this.symbolConsecutiveLosses.set(symbol.toUpperCase(), 0);
      }
    }
  }

  /** Get account summary */
  getAccount(): SimulationAccount {
    return {
      initialCapital: configManager.getSection('simulation').initialCapital,
      accountBalance: this.state.accountBalance,
      availableCapital: this.state.availableCapital,
      usedCapital: this.state.usedCapital,
      dailyPnl: this.state.dailyPnl,
      totalPnl: this.state.totalPnl,
      mode: 'SIMULATION',
    };
  }

  /** Get risk state (for UI display) */
  getState(): RiskState & { riskPerTrade: number } {
    return { ...this.state, riskPerTrade: configManager.getSection('risk').riskPerTrade };
  }

  /** Reset daily counters */
  resetDaily(): void {
    this.state.dailyPnl = 0;
    this.state.dailyTradeCount = 0;
    this.state.halted = false;
    this.state.haltReason = '';
    this.state.consecutiveLosses = 0;
    this.symbolConsecutiveLosses.clear();
  }

  /** Full reset */
  reset(): void {
    this.symbolConsecutiveLosses.clear();
    const cfg = configManager.getSection('simulation');
    this.state = {
      accountBalance: cfg.initialCapital,
      availableCapital: cfg.initialCapital,
      usedCapital: 0,
      dailyPnl: 0,
      totalPnl: 0,
      openCEPositions: 0,
      openPEPositions: 0,
      totalOpenPositions: 0,
      consecutiveLosses: 0,
      dailyTradeCount: 0,
      lastTradeTime: 0,
      lastLossTime: 0,
      halted: false,
      haltReason: '',
    };
  }

  /** Check if trade is allowed (quick check) */
  canTrade(): boolean {
    if (this.state.halted) return false;
    const cfg = configManager.getSection('risk');
    if (this.state.totalOpenPositions >= cfg.maxTotalPositions) return false;
    if (this.state.usedCapital / this.state.accountBalance >= cfg.maxCapitalExposure) return false;
    return true;
  }
}

export const riskEngine = new RiskEngine();
