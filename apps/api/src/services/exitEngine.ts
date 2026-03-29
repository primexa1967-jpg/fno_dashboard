/**
 * Intraday Exit Engine Service — v3 (REVISED)
 *
 * Priority-ordered exit conditions (first match wins).
 * IV / gamma / theta-based exits removed — structure, stop, trail, OI flow, premium weakness only.
 *   1. OI Distribution  – Long Unwinding (compare 3 minutes ago)
 *   2. Hard Stop         – P&L ≤ -25 %
 *   3. Final Target      – P&L ≥ 100 %
 *   4. Trailing Stop     – P&L ≥ 25 %, price ≤ 88 % of peak
 *   5. Premium Weakness  – Time ≥ 13:45, Price < VWAP, P&L < 20%
 *   default → HOLD
 *
 * Enhanced Entry Validation with EMA, Momentum, Session filters.
 * Per-index OI/Gamma thresholds.
 */

// ─────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────

export type ExitType =
  | 'OI_DISTRIBUTION'
  | 'GAMMA_RISK'
  | 'HARD_STOP'
  | 'FINAL_TARGET'
  | 'IV_SPIKE'
  | 'TRAILING_STOP'
  | 'PREMIUM_WEAKNESS'
  | 'THETA_DECAY'
  | 'HOLD';

export type Urgency = 'IMMEDIATE' | 'SOON' | 'HOLD';

export interface TradePosition {
  id: string;
  symbol: string;
  strike: number;
  optionType: 'CE' | 'PE';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  entryTime: number;             // epoch ms
  entryIV?: number;
  currentIV?: number;
  /** Highest premium observed since entry (tick-level) */
  highestPrice?: number;
  /** Greeks from option chain */
  delta?: number;
  gamma?: number;
  /** Bid-ask spread % of mid */
  bidAskSpreadPct?: number;
  /** Option VWAP (running) */
  optionVWAP?: number;
}

export interface ExitSignal {
  action: 'EXIT' | 'HOLD';
  exitType: ExitType;
  reason: string;
  urgency: Urgency;
  pnlPercent: number;
  pnlAbsolute: number;
  priority: number;              // 1-8 (lower = higher)
  details?: string;
}

export interface RiskParameters {
  hardStopPct: number;           // 25 %
  trailTriggerPct: number;       // ≥ 25 %
  trailCutPct: number;           // 12 % drop from peak → exit at 88 % of peak
  gammaCutoffHour: number;       // 14
  gammaCutoffMinute: number;     // 15
  gammaPctThreshold: number;     // 0.1 % of spot
  gammaPnlGate: number;          // 40 % — only fire gamma if P&L < this
  thetaCutoffHour: number;       // 14
  thetaCutoffMinute: number;     // 30
  thetaPnlThreshold: number;     // 25 %
  finalTargetPct: number;        // 100 %
  ivSpikeMultiplier: number;     // 1.5
  ivSpikePnlThreshold: number;   // 20 %
  oiChangeThresholdPct: number;  // per-index (default 3%)
  oiLookbackCandles: number;     // 3 (compare 3 minutes ago)
  premiumWeaknessHour: number;   // 13
  premiumWeaknessMinute: number; // 45
  premiumWeaknessPnl: number;    // 20 %
}

export interface EntryValidation {
  passed: boolean;
  checks: EntryCheck[];
  score: number;                 // total passed / total checks
}

export interface EntryCheck {
  name: string;
  passed: boolean;
  value: string;
  required: string;
}

export interface OneMinCandle {
  timestamp: number;
  spotPrice: number;
  ceOI: number;
  peOI: number;
  iv: number;
  volume: number;
}

export interface ExitSummary {
  totalPositions: number;
  immediateExits: number;
  soonExits: number;
  inProfit: number;
  inLoss: number;
  riskParams: RiskParameters;
  signals: Array<{ position: TradePosition; signal: ExitSignal }>;
}

// ─────────────────────────────────────────────────────────────
//  PER-INDEX CONFIG TABLES
// ─────────────────────────────────────────────────────────────

export interface IndexConfig {
  strikeStep: number;
  oiExitPct: number;
  gammaLimitLow: number;
  gammaLimitHigh: number;
  minOI: number;
  minVolume: number;
  vwapLimitPct: number;
  lotSize: number;
}

export const INDEX_CONFIGS: Record<string, IndexConfig> = {
  NIFTY:        { strikeStep: 50,  oiExitPct: 3,   gammaLimitLow: 10, gammaLimitHigh: 15, minOI: 100000, minVolume: 5000, vwapLimitPct: 0.5, lotSize: 50 },
  BANKNIFTY:    { strikeStep: 100, oiExitPct: 4,   gammaLimitLow: 20, gammaLimitHigh: 25, minOI: 80000,  minVolume: 3000, vwapLimitPct: 0.6, lotSize: 15 },
  FINNIFTY:     { strikeStep: 50,  oiExitPct: 3,   gammaLimitLow: 10, gammaLimitHigh: 15, minOI: 50000,  minVolume: 2000, vwapLimitPct: 0.5, lotSize: 25 },
  MIDCAPNIFTY:  { strikeStep: 25,  oiExitPct: 2.5, gammaLimitLow: 5,  gammaLimitHigh: 8,  minOI: 30000,  minVolume: 1500, vwapLimitPct: 0.4, lotSize: 75 },
  SENSEX:       { strikeStep: 100, oiExitPct: 3.5, gammaLimitLow: 20, gammaLimitHigh: 25, minOI: 60000,  minVolume: 2000, vwapLimitPct: 0.5, lotSize: 10 },
  BANKEX:       { strikeStep: 100, oiExitPct: 3.5, gammaLimitLow: 20, gammaLimitHigh: 25, minOI: 60000,  minVolume: 2000, vwapLimitPct: 0.6, lotSize: 15 },
};

const DEFAULT_INDEX_CONFIG: IndexConfig = INDEX_CONFIGS.NIFTY;

export function getIndexConfig(symbol: string): IndexConfig {
  return INDEX_CONFIGS[symbol.toUpperCase()] || DEFAULT_INDEX_CONFIG;
}

// ─────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────

const DEFAULT_RISK: RiskParameters = {
  hardStopPct: 25,
  trailTriggerPct: 25,
  trailCutPct: 12,
  gammaCutoffHour: 14,
  gammaCutoffMinute: 15,
  gammaPctThreshold: 0.1,
  gammaPnlGate: 40,
  thetaCutoffHour: 14,
  thetaCutoffMinute: 30,
  thetaPnlThreshold: 25,
  finalTargetPct: 100,
  ivSpikeMultiplier: 1.5,
  ivSpikePnlThreshold: 20,
  oiChangeThresholdPct: 3,
  oiLookbackCandles: 3,
  premiumWeaknessHour: 13,
  premiumWeaknessMinute: 45,
  premiumWeaknessPnl: 20,
};

// ─────────────────────────────────────────────────────────────
//  SERVICE
// ─────────────────────────────────────────────────────────────

class ExitEngineService {
  private risk: RiskParameters;

  /**
   * 1-minute candle ring buffer per symbol, max 60 candles (~1 hour).
   * Pushed externally via `pushCandle()`.
   */
  private candles: Map<string, OneMinCandle[]> = new Map();
  private readonly MAX_CANDLES = 60;

  /**
   * Track highest premium per position id (tick-level).
   */
  private peakPrices: Map<string, number> = new Map();

  constructor() {
    this.risk = { ...DEFAULT_RISK };
  }

  // ── Risk parameter CRUD ────────────────────────────────────

  getRisk(): RiskParameters {
    return { ...this.risk };
  }

  setRisk(partial: Partial<RiskParameters>): void {
    this.risk = { ...this.risk, ...partial };
  }

  // ── 1-min candle ingestion ─────────────────────────────────

  pushCandle(symbol: string, candle: OneMinCandle): void {
    if (!this.candles.has(symbol)) this.candles.set(symbol, []);
    const buf = this.candles.get(symbol)!;
    buf.push(candle);
    if (buf.length > this.MAX_CANDLES) buf.shift();
  }

  getCandles(symbol: string): OneMinCandle[] {
    return this.candles.get(symbol) || [];
  }

  // ── Peak price tracking (tick-level) ───────────────────────

  updatePeakPrice(positionId: string, currentPrice: number): number {
    const prev = this.peakPrices.get(positionId) || currentPrice;
    const peak = Math.max(prev, currentPrice);
    this.peakPrices.set(positionId, peak);
    return peak;
  }

  getPeakPrice(positionId: string): number | undefined {
    return this.peakPrices.get(positionId);
  }

  clearPeakPrice(positionId: string): void {
    this.peakPrices.delete(positionId);
  }

  // ── Helpers ────────────────────────────────────────────────

  private pnl(pos: TradePosition): { percent: number; absolute: number } {
    const diff = pos.currentPrice - pos.entryPrice;
    return {
      percent: Number(((diff / pos.entryPrice) * 100).toFixed(2)),
      absolute: Number((diff * pos.quantity).toFixed(2)),
    };
  }

  private nowIST(): Date {
    const utc = new Date();
    return new Date(utc.getTime() + (5.5 * 60 * 60 * 1000 - utc.getTimezoneOffset() * 60 * 1000));
  }

  private timeGTE(h: number, m: number): boolean {
    const now = this.nowIST();
    return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
  }

  // ─────────────────────────────────────────────────────────
  //  EXIT CASCADE — (first match wins)
  // ─────────────────────────────────────────────────────────

  evaluatePosition(pos: TradePosition, spotPrice?: number): ExitSignal {
    const { percent: pnlPct, absolute: pnlAbs } = this.pnl(pos);
    const cfg = getIndexConfig(pos.symbol);

    // Update peak price on every evaluation (tick-level tracking)
    const peak = this.updatePeakPrice(pos.id, pos.currentPrice);

    // ── 1. OI Distribution Exit (compare 3 minutes ago) ──────
    {
      const buf = this.candles.get(pos.symbol) || [];
      const lookback = this.risk.oiLookbackCandles;
      if (buf.length > lookback) {
        const curr = buf[buf.length - 1];
        const prev = buf[buf.length - 1 - lookback]; // 3 minutes ago

        const oiThreshold = cfg.oiExitPct; // per-index

        if (pos.optionType === 'CE') {
          const oiDrop = prev.ceOI > 0 ? ((prev.ceOI - curr.ceOI) / prev.ceOI) * 100 : 0;
          if (
            curr.spotPrice < prev.spotPrice &&
            curr.ceOI < prev.ceOI &&
            Math.abs(oiDrop) >= oiThreshold
          ) {
            return {
              action: 'EXIT',
              exitType: 'OI_DISTRIBUTION',
              reason: 'Long Unwinding – CE OI dropping with falling spot (3m comparison)',
              urgency: 'IMMEDIATE',
              pnlPercent: pnlPct,
              pnlAbsolute: pnlAbs,
              priority: 1,
              details: `CE OI Δ = ${oiDrop.toFixed(2)}% (${lookback}m) | Threshold: ${oiThreshold}% | Spot ${curr.spotPrice.toFixed(2)} < ${prev.spotPrice.toFixed(2)}`,
            };
          }
        }

        if (pos.optionType === 'PE') {
          const oiDrop = prev.peOI > 0 ? ((prev.peOI - curr.peOI) / prev.peOI) * 100 : 0;
          if (
            curr.spotPrice > prev.spotPrice &&
            curr.peOI < prev.peOI &&
            Math.abs(oiDrop) >= oiThreshold
          ) {
            return {
              action: 'EXIT',
              exitType: 'OI_DISTRIBUTION',
              reason: 'Long Unwinding – PE OI dropping with rising spot (3m comparison)',
              urgency: 'IMMEDIATE',
              pnlPercent: pnlPct,
              pnlAbsolute: pnlAbs,
              priority: 1,
              details: `PE OI Δ = ${oiDrop.toFixed(2)}% (${lookback}m) | Threshold: ${oiThreshold}% | Spot ${curr.spotPrice.toFixed(2)} > ${prev.spotPrice.toFixed(2)}`,
            };
          }
        }
      }
    }

    // ── 2. Hard Stop Exit ─────────────────────────────────────
    if (pnlPct <= -this.risk.hardStopPct) {
      return {
        action: 'EXIT',
        exitType: 'HARD_STOP',
        reason: `Loss of ${Math.abs(pnlPct).toFixed(1)}% exceeds hard stop (${this.risk.hardStopPct}%)`,
        urgency: 'IMMEDIATE',
        pnlPercent: pnlPct,
        pnlAbsolute: pnlAbs,
        priority: 2,
      };
    }

    // ── 3. Final Target Exit ───────────────────────────────────
    if (pnlPct >= this.risk.finalTargetPct) {
      return {
        action: 'EXIT',
        exitType: 'FINAL_TARGET',
        reason: `Target of +${this.risk.finalTargetPct}% achieved! Book full profit.`,
        urgency: 'SOON',
        pnlPercent: pnlPct,
        pnlAbsolute: pnlAbs,
        priority: 3,
      };
    }

    // ── 4. Trailing Stop Exit (trigger 25%, cut 12%) ─────────
    if (pnlPct >= this.risk.trailTriggerPct && peak > 0) {
      const trailFloor = peak * (1 - this.risk.trailCutPct / 100); // 88% of peak
      if (pos.currentPrice <= trailFloor) {
        return {
          action: 'EXIT',
          exitType: 'TRAILING_STOP',
          reason: `Price (₹${pos.currentPrice.toFixed(2)}) fell below trailing floor (₹${trailFloor.toFixed(2)})`,
          urgency: 'SOON',
          pnlPercent: pnlPct,
          pnlAbsolute: pnlAbs,
          priority: 4,
          details: `Peak = ₹${peak.toFixed(2)} | Floor (${100 - this.risk.trailCutPct}%) = ₹${trailFloor.toFixed(2)}`,
        };
      }
    }

    // ── 5. Premium Weakness Exit ─────────────────────────────
    // Time ≥ 13:45, OptionPrice < Option_VWAP, P&L < 20%
    if (
      this.timeGTE(this.risk.premiumWeaknessHour, this.risk.premiumWeaknessMinute) &&
      pos.optionVWAP !== undefined &&
      pos.optionVWAP > 0 &&
      pos.currentPrice < pos.optionVWAP &&
      pnlPct < this.risk.premiumWeaknessPnl
    ) {
      return {
        action: 'EXIT',
        exitType: 'PREMIUM_WEAKNESS',
        reason: `Premium below VWAP after ${this.risk.premiumWeaknessHour}:${String(this.risk.premiumWeaknessMinute).padStart(2, '0')} — weak momentum`,
        urgency: 'SOON',
        pnlPercent: pnlPct,
        pnlAbsolute: pnlAbs,
        priority: 5,
        details: `Price ₹${pos.currentPrice.toFixed(2)} < VWAP ₹${pos.optionVWAP.toFixed(2)} | P&L ${pnlPct.toFixed(1)}% < ${this.risk.premiumWeaknessPnl}%`,
      };
    }

    // ── Default: HOLD ─────────────────────────────────────────
    return {
      action: 'HOLD',
      exitType: 'HOLD',
      reason: 'Structure Intact — no exit triggered',
      urgency: 'HOLD',
      pnlPercent: pnlPct,
      pnlAbsolute: pnlAbs,
      priority: 6,
    };
  }

  // ─────────────────────────────────────────────────────────
  //  BATCH SUMMARY
  // ─────────────────────────────────────────────────────────

  evaluateAll(positions: TradePosition[], spotPrice?: number): ExitSummary {
    const signals = positions.map(pos => ({
      position: pos,
      signal: this.evaluatePosition(pos, spotPrice),
    }));

    return {
      totalPositions: positions.length,
      immediateExits: signals.filter(s => s.signal.urgency === 'IMMEDIATE').length,
      soonExits: signals.filter(s => s.signal.urgency === 'SOON').length,
      inProfit: signals.filter(s => s.signal.pnlPercent > 0).length,
      inLoss: signals.filter(s => s.signal.pnlPercent <= 0).length,
      riskParams: this.getRisk(),
      signals,
    };
  }

  // ─────────────────────────────────────────────────────────
  //  ENHANCED ENTRY VALIDATION
  // ─────────────────────────────────────────────────────────

  validateEntry(params: {
    optionType: 'CE' | 'PE';
    symbol: string;
    spotPrice: number;
    vwap: number;
    spotTrend: 'UP' | 'DOWN' | 'NEUTRAL';
    oiStructure: string;       // 'LB' | 'SB' | 'SC' | 'LU' | etc.
    volume: number;
    avgVolume: number;
    delta: number;
    currentIV: number;
    avgIV: number;
    bidAskSpreadPct: number;
    // ── NEW enhanced entry params ──
    ema9?: number;
    ema21?: number;
    candleRange?: number;        // current candle High - Low
    avgRange10?: number;         // SMA(10) of candle ranges
    currentClose?: number;
    previousHigh?: number;
    previousLow?: number;
    strikePrice?: number;
    strikeOI?: number;
    activeCECount?: number;      // number of active CE positions
    activePECount?: number;      // number of active PE positions
    totalPositions?: number;     // total active positions
  }): EntryValidation {
    const p = params;
    const cfg = getIndexConfig(p.symbol || 'NIFTY');
    const checks: EntryCheck[] = [];

    // ── Session Window (09:20 - 14:30) ──
    const inSession = this.timeGTE(9, 20) && !this.timeGTE(14, 30);
    checks.push({
      name: 'Session Window',
      passed: inSession,
      value: inSession ? 'In window' : 'Outside 09:20-14:30',
      required: '09:20 — 14:30 IST',
    });

    if (p.optionType === 'CE') {
      // ── Spot Trend ──
      checks.push({
        name: 'Spot Trend',
        passed: p.spotTrend === 'UP',
        value: p.spotTrend,
        required: 'Bullish (UP)',
      });

      // ── Spot > VWAP ──
      checks.push({
        name: 'Spot > VWAP',
        passed: p.spotPrice > p.vwap,
        value: `${p.spotPrice.toFixed(2)} vs ${p.vwap.toFixed(2)}`,
        required: 'Spot > VWAP',
      });

      // ── VWAP Distance ≤ limit ──
      const vwapDist = p.vwap > 0 ? Math.abs(p.spotPrice - p.vwap) / p.vwap * 100 : 99;
      checks.push({
        name: `VWAP Distance ≤ ${cfg.vwapLimitPct}%`,
        passed: vwapDist <= cfg.vwapLimitPct,
        value: `${vwapDist.toFixed(2)}%`,
        required: `≤ ${cfg.vwapLimitPct}%`,
      });

      // ── EMA9 > EMA21 (trend confirmation) ──
      if (p.ema9 !== undefined && p.ema21 !== undefined) {
        checks.push({
          name: 'EMA9 > EMA21 (Trend)',
          passed: p.ema9 > p.ema21,
          value: `${p.ema9.toFixed(2)} vs ${p.ema21.toFixed(2)}`,
          required: 'EMA9 > EMA21',
        });
      }

      // ── CurrentClose > PreviousHigh ──
      if (p.currentClose !== undefined && p.previousHigh !== undefined) {
        checks.push({
          name: 'Close > Prev High',
          passed: p.currentClose > p.previousHigh,
          value: `${p.currentClose.toFixed(2)} vs ${p.previousHigh.toFixed(2)}`,
          required: 'Close > Previous High',
        });
      }

      // ── OI Structure ──
      checks.push({
        name: 'OI Structure',
        passed: p.oiStructure === 'LB',
        value: p.oiStructure,
        required: 'Long Buildup (LB)',
      });

      // ── Volume > 1.3× Avg ──
      checks.push({
        name: 'Volume > 1.3× Avg',
        passed: p.volume > p.avgVolume * 1.3,
        value: `${(p.avgVolume > 0 ? p.volume / p.avgVolume : 0).toFixed(2)}×`,
        required: '> 1.3×',
      });

      // ── Delta > 0.45 ──
      checks.push({
        name: 'Delta > 0.45',
        passed: p.delta > 0.45,
        value: p.delta.toFixed(3),
        required: '> 0.45',
      });

      // ── No IV Spike ──
      checks.push({
        name: 'No IV Spike',
        passed: p.currentIV <= p.avgIV * 1.5,
        value: `${p.currentIV.toFixed(1)} vs ${(p.avgIV * 1.5).toFixed(1)}`,
        required: 'IV ≤ 1.5× Avg',
      });

      // ── Bid-Ask ≤ 3% ──
      checks.push({
        name: 'Bid-Ask ≤ 3%',
        passed: p.bidAskSpreadPct <= 3,
        value: `${p.bidAskSpreadPct.toFixed(1)}%`,
        required: '≤ 3%',
      });

    } else {
      // ── PE entry checks ──
      checks.push({
        name: 'Spot Trend',
        passed: p.spotTrend === 'DOWN',
        value: p.spotTrend,
        required: 'Bearish (DOWN)',
      });

      checks.push({
        name: 'Spot < VWAP',
        passed: p.spotPrice < p.vwap,
        value: `${p.spotPrice.toFixed(2)} vs ${p.vwap.toFixed(2)}`,
        required: 'Spot < VWAP',
      });

      const vwapDist = p.vwap > 0 ? Math.abs(p.spotPrice - p.vwap) / p.vwap * 100 : 99;
      checks.push({
        name: `VWAP Distance ≤ ${cfg.vwapLimitPct}%`,
        passed: vwapDist <= cfg.vwapLimitPct,
        value: `${vwapDist.toFixed(2)}%`,
        required: `≤ ${cfg.vwapLimitPct}%`,
      });

      if (p.ema9 !== undefined && p.ema21 !== undefined) {
        checks.push({
          name: 'EMA9 < EMA21 (Trend)',
          passed: p.ema9 < p.ema21,
          value: `${p.ema9.toFixed(2)} vs ${p.ema21.toFixed(2)}`,
          required: 'EMA9 < EMA21',
        });
      }

      if (p.currentClose !== undefined && p.previousLow !== undefined) {
        checks.push({
          name: 'Close < Prev Low',
          passed: p.currentClose < p.previousLow,
          value: `${p.currentClose.toFixed(2)} vs ${p.previousLow.toFixed(2)}`,
          required: 'Close < Previous Low',
        });
      }

      checks.push({
        name: 'OI Structure',
        passed: p.oiStructure === 'SB',
        value: p.oiStructure,
        required: 'Short Buildup (SB)',
      });

      checks.push({
        name: 'Volume > 1.3× Avg',
        passed: p.volume > p.avgVolume * 1.3,
        value: `${(p.avgVolume > 0 ? p.volume / p.avgVolume : 0).toFixed(2)}×`,
        required: '> 1.3×',
      });

      checks.push({
        name: 'Delta < -0.45',
        passed: p.delta < -0.45,
        value: p.delta.toFixed(3),
        required: '< -0.45',
      });

      checks.push({
        name: 'No IV Spike',
        passed: p.currentIV <= p.avgIV * 1.5,
        value: `${p.currentIV.toFixed(1)} vs ${(p.avgIV * 1.5).toFixed(1)}`,
        required: 'IV ≤ 1.5× Avg',
      });

      checks.push({
        name: 'Bid-Ask ≤ 3%',
        passed: p.bidAskSpreadPct <= 3,
        value: `${p.bidAskSpreadPct.toFixed(1)}%`,
        required: '≤ 3%',
      });
    }

    // ── Common checks ──

    // Momentum Expansion: CandleRange ≥ 1.2× AvgRange(10)
    if (p.candleRange !== undefined && p.avgRange10 !== undefined && p.avgRange10 > 0) {
      checks.push({
        name: 'Momentum Expansion',
        passed: p.candleRange >= 1.2 * p.avgRange10,
        value: `${(p.candleRange / p.avgRange10).toFixed(2)}×`,
        required: '≥ 1.2× AvgRange(10)',
      });
    }

    // Strike Distance ≤ 0.6% of Spot
    if (p.strikePrice !== undefined && p.spotPrice > 0) {
      const strikeDist = Math.abs(p.strikePrice - p.spotPrice) / p.spotPrice * 100;
      checks.push({
        name: 'Strike Distance ≤ 0.6%',
        passed: strikeDist <= 0.6,
        value: `${strikeDist.toFixed(2)}%`,
        required: '≤ 0.6% of Spot',
      });
    }

    // Min OI per index
    if (p.strikeOI !== undefined) {
      checks.push({
        name: `Min OI (${cfg.minOI.toLocaleString()})`,
        passed: p.strikeOI >= cfg.minOI,
        value: p.strikeOI.toLocaleString(),
        required: `≥ ${cfg.minOI.toLocaleString()}`,
      });
    }

    // Position Limits (max 2 CE, 2 PE, 4 total)
    const ceCnt = p.activeCECount ?? 0;
    const peCnt = p.activePECount ?? 0;
    const total = p.totalPositions ?? 0;
    if (p.optionType === 'CE') {
      checks.push({
        name: 'Position Limit (CE ≤ 2)',
        passed: ceCnt < 2,
        value: `${ceCnt} active`,
        required: '< 2 CE',
      });
    } else {
      checks.push({
        name: 'Position Limit (PE ≤ 2)',
        passed: peCnt < 2,
        value: `${peCnt} active`,
        required: '< 2 PE',
      });
    }
    checks.push({
      name: 'Total Positions ≤ 4',
      passed: total < 4,
      value: `${total} active`,
      required: '< 4 total',
    });

    const passedCount = checks.filter(c => c.passed).length;
    return {
      passed: checks.every(c => c.passed),
      checks,
      score: checks.length > 0 ? Number((passedCount / checks.length * 100).toFixed(1)) : 0,
    };
  }

  // ─────────────────────────────────────────────────────────
  //  UTILITIES
  // ─────────────────────────────────────────────────────────

  /** Time remaining until theta cutoff */
  getTimeToThetaCutoff(): { hours: number; minutes: number; seconds: number } {
    const now = this.nowIST();
    const target = new Date(now);
    target.setHours(this.risk.thetaCutoffHour, this.risk.thetaCutoffMinute, 0, 0);
    const diff = target.getTime() - now.getTime();
    if (diff <= 0) return { hours: 0, minutes: 0, seconds: 0 };
    return {
      hours: Math.floor(diff / 3600000),
      minutes: Math.floor((diff % 3600000) / 60000),
      seconds: Math.floor((diff % 60000) / 1000),
    };
  }

  /** Time remaining until gamma cutoff */
  getTimeToGammaCutoff(): { hours: number; minutes: number; seconds: number } {
    const now = this.nowIST();
    const target = new Date(now);
    target.setHours(this.risk.gammaCutoffHour, this.risk.gammaCutoffMinute, 0, 0);
    const diff = target.getTime() - now.getTime();
    if (diff <= 0) return { hours: 0, minutes: 0, seconds: 0 };
    return {
      hours: Math.floor(diff / 3600000),
      minutes: Math.floor((diff % 3600000) / 60000),
      seconds: Math.floor((diff % 60000) / 1000),
    };
  }

  /** Time remaining until premium weakness cutoff */
  getTimeToPremiumCutoff(): { hours: number; minutes: number; seconds: number } {
    const now = this.nowIST();
    const target = new Date(now);
    target.setHours(this.risk.premiumWeaknessHour, this.risk.premiumWeaknessMinute, 0, 0);
    const diff = target.getTime() - now.getTime();
    if (diff <= 0) return { hours: 0, minutes: 0, seconds: 0 };
    return {
      hours: Math.floor(diff / 3600000),
      minutes: Math.floor((diff % 3600000) / 60000),
      seconds: Math.floor((diff % 60000) / 1000),
    };
  }

  /** Get index configuration */
  getIndexConfig(symbol: string): IndexConfig {
    return getIndexConfig(symbol);
  }

  /** Recommended lot size based on risk % of capital */
  calculatePositionSize(
    capital: number,
    riskPct: number,
    entryPrice: number,
  ): { quantity: number; maxLoss: number } {
    const maxRisk = capital * (riskPct / 100);
    const stopPerUnit = entryPrice * (this.risk.hardStopPct / 100);
    const qty = Math.max(1, Math.floor(maxRisk / stopPerUnit));
    return { quantity: qty, maxLoss: Number((qty * stopPerUnit).toFixed(2)) };
  }
}

export const exitEngineService = new ExitEngineService();
