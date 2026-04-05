/**
 * Simulation Engine — Paper Trading & Trade Lifecycle
 *
 * Spec: §96-97 (Simulation Mode), §232-283 (Simulation Capital Engine + UI)
 * Manages: trade objects, lifecycle, PnL, performance metrics, logging.
 *
 * PIN-protected: user-defined PIN verified against SIMULATION_PIN_HASH (sha256 hex), or dev default.
 */

import { createHash } from 'crypto';
import {
  TRADE_STATUS, EXIT_REASON, SIM_MODE, TRADE_CLASSIFICATION,
  type TradeObject, type TradeContext, type SimulationAccount,
  type PerformanceMetrics, type RejectionEntry,
  type TradeStatusType, type ExitReasonType, type SimModeType,
  type StrengthType, type ConfidenceZoneType, type TradeZoneType, type TriggerTypeValue,
  type TradeClassificationType,
} from './constants';
import { configManager } from './configManager';
import { riskEngine } from './riskEngine';
import { persistEngineSnapshot } from '../enginePersistence';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// ─────────────────────────────────────────────────────────────
//  SIMULATION ENGINE
// ─────────────────────────────────────────────────────────────

class SimulationEngine {
  private queuePersist(): void {
    persistEngineSnapshot({
      simulation: this.exportSnapshotForPersistence(),
      risk: riskEngine.exportStateSnapshot(),
    });
  }

  private openTrades: Map<string, TradeObject> = new Map();
  private closedTrades: TradeObject[] = [];
  private rejections: RejectionEntry[] = [];
  private tradeCounter: number = 0;
  private mode: SimModeType = SIM_MODE.SIMULATION;
  private pinVerified: boolean = false;

  // ─── PIN AUTH (§171-177) ─────────────────────────────────

  /**
   * Verify PIN against SIMULATION_PIN_HASH (recommended) or sha256(SIMULATION_DEFAULT_PIN).
   * Production: set SIMULATION_PIN_HASH to sha256 hex of your PIN — never commit plaintext.
   */
  verifyPin(pin: string): boolean {
    const envHash = process.env.SIMULATION_PIN_HASH?.trim().toLowerCase();
    const expected =
      envHash && envHash.length > 0
        ? envHash
        : sha256Hex(process.env.SIMULATION_DEFAULT_PIN ?? '729995');
    this.pinVerified = sha256Hex(pin ?? '') === expected;
    return this.pinVerified;
  }

  /** §177: Lock panel */
  lockPanel(): void {
    this.pinVerified = false;
  }

  /** Check if panel is unlocked */
  isUnlocked(): boolean {
    return this.pinVerified;
  }

  // ─── MODE CONTROL (§257-259) ─────────────────────────────

  getMode(): SimModeType { return this.mode; }
  setMode(mode: SimModeType): void { this.mode = mode; }

  // ─── TRADE CREATION (§235-239) ────────────────────────────

  /**
   * Create a new simulated trade (§236-238).
   */
  createTrade(params: {
    symbol: string;
    direction: 'BUY' | 'SELL';
    optionType: 'CE' | 'PE';
    strike: number;
    entryPrice: number;
    quantity: number;
    stopLoss: number;
    target: number;
    confidenceScore: number;
    strength: StrengthType;
    confidence: ConfidenceZoneType;
    tradeZone: TradeZoneType;
    triggerType: TriggerTypeValue;
    tradeType: TradeClassificationType;
    context: TradeContext;
    setupType?: string;
  }): TradeObject | null {
    this.tradeCounter++;
    const tradeId = `SIM-${Date.now()}-${this.tradeCounter}`;

    // §237: Apply slippage to entry price
    const slippage = this.calculateSlippage(params.entryPrice);
    const adjustedEntry = params.direction === 'BUY'
      ? params.entryPrice + slippage
      : params.entryPrice - slippage;

    const trade: TradeObject = {
      tradeId,
      symbol: params.symbol,
      direction: params.direction,
      optionType: params.optionType,
      strike: params.strike,
      entryPrice: Number(adjustedEntry.toFixed(2)),
      exitPrice: null,
      currentPrice: adjustedEntry,
      quantity: params.quantity,
      status: TRADE_STATUS.RUNNING,
      entryTime: Date.now(),
      exitTime: null,
      stopLoss: params.stopLoss,
      target: params.target,
      trailingStopLoss: null,
      confidenceScore: params.confidenceScore,
      strength: params.strength,
      confidence: params.confidence,
      tradeZone: params.tradeZone,
      triggerType: params.triggerType,
      tradeType: params.tradeType,
      unrealizedPnl: 0,
      realizedPnl: 0,
      peakPrice: adjustedEntry,
      duration: 0,
      exitReason: null,
      context: params.context,
      setupType: params.setupType,
    };

    // §238: Deduct margin
    const margin = params.quantity * adjustedEntry;
    riskEngine.allocateCapital(margin, params.optionType);

    this.openTrades.set(tradeId, trade);
    console.log(`📊 SIM: Trade opened ${tradeId} ${params.direction} ${params.symbol} ${params.strike}${params.optionType} @ ${adjustedEntry}`);
    this.queuePersist();

    return trade;
  }

  // ─── LIVE PnL UPDATE (§240-241) ──────────────────────────

  /**
   * Update a trade with current market price.
   */
  updateTrade(
    tradeId: string,
    currentPrice: number,
    exitHints?: TradeObject['liveExitHints']
  ): TradeObject | null {
    const trade = this.openTrades.get(tradeId);
    if (!trade || trade.status !== TRADE_STATUS.RUNNING) return null;

    trade.currentPrice = currentPrice;
    if (exitHints) {
      trade.liveExitHints = { ...trade.liveExitHints, ...exitHints };
    }
    trade.duration = Date.now() - trade.entryTime;

    // §240: Calculate PnL
    const multiplier = trade.direction === 'BUY' ? 1 : -1;
    trade.unrealizedPnl = Number(((currentPrice - trade.entryPrice) * multiplier * trade.quantity).toFixed(2));

    // Track peak price
    if (trade.direction === 'BUY' && currentPrice > trade.peakPrice) trade.peakPrice = currentPrice;
    if (trade.direction === 'SELL' && currentPrice < trade.peakPrice) trade.peakPrice = currentPrice;

    // §103: Enable trailing stop at 25% profit
    const pnlPct = ((currentPrice - trade.entryPrice) / trade.entryPrice) * multiplier * 100;
    const simCfg = configManager.getSection('simulation');

    if (pnlPct >= simCfg.trailingStopTriggerPct && !trade.trailingStopLoss) {
      const cutPct = simCfg.trailingStopCutPct / 100;
      trade.trailingStopLoss = trade.direction === 'BUY'
        ? Number((trade.peakPrice * (1 - cutPct)).toFixed(2))
        : Number((trade.peakPrice * (1 + cutPct)).toFixed(2));
    }

    // Update trailing stop from peak
    if (trade.trailingStopLoss) {
      const cutPct = simCfg.trailingStopCutPct / 100;
      if (trade.direction === 'BUY') {
        const newTrail = Number((trade.peakPrice * (1 - cutPct)).toFixed(2));
        trade.trailingStopLoss = Math.max(trade.trailingStopLoss, newTrail);
      } else {
        const newTrail = Number((trade.peakPrice * (1 + cutPct)).toFixed(2));
        trade.trailingStopLoss = Math.min(trade.trailingStopLoss, newTrail);
      }
    }

    return trade;
  }

  // ─── EXIT (§242-246) ──────────────────────────────────────

  /**
   * Close a trade with exit reason.
   */
  closeTrade(tradeId: string, exitPrice: number, exitReason: ExitReasonType): TradeObject | null {
    const trade = this.openTrades.get(tradeId);
    if (!trade) return null;

    // §242: Apply slippage to exit
    const slippage = this.calculateSlippage(exitPrice);
    const adjustedExit = trade.direction === 'BUY'
      ? exitPrice - slippage
      : exitPrice + slippage;

    trade.exitPrice = Number(adjustedExit.toFixed(2));
    trade.exitTime = Date.now();
    trade.status = TRADE_STATUS.CLOSED;
    trade.exitReason = exitReason;
    trade.duration = trade.exitTime - trade.entryTime;

    // §243: Final PnL
    const multiplier = trade.direction === 'BUY' ? 1 : -1;
    trade.realizedPnl = Number(((adjustedExit - trade.entryPrice) * multiplier * trade.quantity).toFixed(2));
    trade.unrealizedPnl = 0;

    // §244-245: Update balance & release margin
    const margin = trade.quantity * trade.entryPrice;
    riskEngine.releaseCapital(margin, trade.realizedPnl, trade.optionType, trade.symbol);

    // Move to closed trades
    this.openTrades.delete(tradeId);
    this.closedTrades.push(trade);

    console.log(`📊 SIM: Trade closed ${tradeId} PnL=${trade.realizedPnl} Reason=${exitReason}`);
    this.queuePersist();
    return trade;
  }

  // ─── AUTO EXIT CHECKS (§93-116) ──────────────────────────

  /**
   * Check all open trades for exit conditions.
   * Call this on every tick/update cycle.
   */
  checkExits(): Array<{ tradeId: string; reason: ExitReasonType }> {
    const exits: Array<{ tradeId: string; reason: ExitReasonType }> = [];
    const simCfg = configManager.getSection('simulation');

    for (const [tradeId, trade] of this.openTrades) {
      const multiplier = trade.direction === 'BUY' ? 1 : -1;
      const pnlPct = ((trade.currentPrice - trade.entryPrice) / trade.entryPrice) * multiplier * 100;

      // §93: Hard stop at -25%
      if (pnlPct <= simCfg.hardStopPnl) {
        exits.push({ tradeId, reason: EXIT_REASON.HARD_SL });
        continue;
      }

      // §106: Full exit at 100%
      if (pnlPct >= simCfg.fullExitPnl) {
        exits.push({ tradeId, reason: EXIT_REASON.TARGET_HIT });
        continue;
      }

      // §107: Trailing stop hit
      if (trade.trailingStopLoss) {
        if (trade.direction === 'BUY' && trade.currentPrice <= trade.trailingStopLoss) {
          exits.push({ tradeId, reason: EXIT_REASON.TRAILING_STOP });
          continue;
        }
        if (trade.direction === 'SELL' && trade.currentPrice >= trade.trailingStopLoss) {
          exits.push({ tradeId, reason: EXIT_REASON.TRAILING_STOP });
          continue;
        }
      }

      const hints = trade.liveExitHints;
      if (hints?.structureBroken) {
        exits.push({ tradeId, reason: EXIT_REASON.STRUCTURE_BREAK });
        continue;
      }
      if (hints?.oppositeSetup) {
        exits.push({ tradeId, reason: EXIT_REASON.OPPOSITE_SIGNAL });
        continue;
      }
      if ((hints?.stagnationBars ?? 0) >= 8) {
        exits.push({ tradeId, reason: EXIT_REASON.STAGNATION_EXIT });
        continue;
      }
      if (hints?.volumeStalled) {
        exits.push({ tradeId, reason: EXIT_REASON.VOLUME_STALL_EXIT });
        continue;
      }

      if (trade.direction === 'BUY' && trade.currentPrice <= trade.stopLoss) {
        exits.push({ tradeId, reason: EXIT_REASON.STOP_LOSS });
        continue;
      }
      if (trade.direction === 'SELL' && trade.currentPrice >= trade.stopLoss) {
        exits.push({ tradeId, reason: EXIT_REASON.STOP_LOSS });
        continue;
      }

      // §110: Target hit
      if (trade.direction === 'BUY' && trade.currentPrice >= trade.target) {
        exits.push({ tradeId, reason: EXIT_REASON.TARGET_HIT });
        continue;
      }
      if (trade.direction === 'SELL' && trade.currentPrice <= trade.target) {
        exits.push({ tradeId, reason: EXIT_REASON.TARGET_HIT });
        continue;
      }

      // §108: Max hold time
      if (trade.duration >= simCfg.maxHoldTimeMinutes * 60 * 1000) {
        exits.push({ tradeId, reason: EXIT_REASON.TIME_EXIT });
        continue;
      }
    }

    return exits;
  }

  // ─── SLIPPAGE MODEL (§260) ────────────────────────────────

  private calculateSlippage(price: number): number {
    const cfg = configManager.getSection('simulation');
    if (cfg.slippageModel === 'FIXED') {
      return price * (cfg.fixedSlippagePct / 100);
    }
    // Dynamic: simplified model
    return price * 0.001; // 0.1% default
  }

  // ─── REJECTION LOG (§268-269) ─────────────────────────────

  logRejection(entry: RejectionEntry): void {
    this.rejections.push(entry);
    if (this.rejections.length > 500) this.rejections.shift();
    this.queuePersist();
  }

  getRecentRejections(count: number = 10): RejectionEntry[] {
    return this.rejections.slice(-count);
  }

  // ─── PERFORMANCE METRICS (§249-250) ──────────────────────

  getPerformance(): PerformanceMetrics {
    const closed = this.closedTrades;
    const wins = closed.filter(t => t.realizedPnl > 0);
    const losses = closed.filter(t => t.realizedPnl <= 0);
    const totalPnl = closed.reduce((sum, t) => sum + t.realizedPnl, 0);

    // Max drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let cumPnl = 0;
    for (const t of closed) {
      cumPnl += t.realizedPnl;
      if (cumPnl > peak) peak = cumPnl;
      const dd = peak - cumPnl;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    return {
      totalTrades: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length > 0 ? Number(((wins.length / closed.length) * 100).toFixed(1)) : 0,
      totalPnl: Number(totalPnl.toFixed(2)),
      avgProfit: wins.length > 0 ? Number((wins.reduce((s, t) => s + t.realizedPnl, 0) / wins.length).toFixed(2)) : 0,
      avgLoss: losses.length > 0 ? Number((losses.reduce((s, t) => s + t.realizedPnl, 0) / losses.length).toFixed(2)) : 0,
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      bestTrade: closed.length > 0 ? Math.max(...closed.map(t => t.realizedPnl)) : 0,
      worstTrade: closed.length > 0 ? Math.min(...closed.map(t => t.realizedPnl)) : 0,
    };
  }

  // ─── GETTERS ──────────────────────────────────────────────

  getOpenTrades(): TradeObject[] {
    return Array.from(this.openTrades.values());
  }

  getClosedTrades(limit: number = 50): TradeObject[] {
    return this.closedTrades.slice(-limit).reverse();
  }

  getTrade(tradeId: string): TradeObject | null {
    return this.openTrades.get(tradeId) || this.closedTrades.find(t => t.tradeId === tradeId) || null;
  }

  getAccount(): SimulationAccount {
    return { ...riskEngine.getAccount(), mode: this.mode };
  }

  // ─── RESET ────────────────────────────────────────────────

  reset(): void {
    this.openTrades.clear();
    this.closedTrades = [];
    this.rejections = [];
    this.tradeCounter = 0;
    riskEngine.reset();
    console.log('📊 SIM: Reset complete');
    this.queuePersist();
  }

  /** Restore open/closed trades after server restart (risk state loaded separately) */
  hydrateFromSnapshot(data: {
    openTrades: TradeObject[];
    closedTrades: TradeObject[];
    rejections: RejectionEntry[];
    tradeCounter: number;
    mode?: SimModeType;
  } | null): void {
    if (!data) return;
    this.openTrades.clear();
    for (const t of data.openTrades || []) {
      if (t?.tradeId) this.openTrades.set(t.tradeId, t);
    }
    this.closedTrades = Array.isArray(data.closedTrades) ? [...data.closedTrades] : [];
    this.rejections = Array.isArray(data.rejections) ? [...data.rejections] : [];
    if (typeof data.tradeCounter === 'number' && data.tradeCounter >= 0) {
      this.tradeCounter = data.tradeCounter;
    }
    if (data.mode === SIM_MODE.SIMULATION || data.mode === SIM_MODE.LIVE) {
      this.mode = data.mode;
    }
  }

  /** Call after batch mark-to-market so LTP changes survive restarts */
  flushStateToDisk(): void {
    this.queuePersist();
  }

  exportSnapshotForPersistence(): {
    openTrades: TradeObject[];
    closedTrades: TradeObject[];
    rejections: RejectionEntry[];
    tradeCounter: number;
    mode: SimModeType;
  } {
    return {
      openTrades: Array.from(this.openTrades.values()),
      closedTrades: [...this.closedTrades],
      rejections: [...this.rejections],
      tradeCounter: this.tradeCounter,
      mode: this.mode,
    };
  }
}

export const simulationEngine = new SimulationEngine();
