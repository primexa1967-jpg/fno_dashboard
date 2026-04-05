/**
 * INTRADAY STOCK OPTION TRADING DASHBOARD — Spec F (v2)
 *
 * LATENCY FIX: Instead of 43+ serial API calls (86s+), this engine
 * now reads from MarketStateStore (instant, ~0ms) which refreshes
 * in the background every 5 seconds.
 *
 * 21 engines across 4 parts:
 *
 * PART 1 — Data Ingestion & Core Market Analytics
 *   Step 1  Data Validation Engine
 *   Step 2  Pre Scanner Engine
 *   Step 3  Market Trend Engine
 *   Step 4  Sector Rotation Engine
 *   Step 5  Volume Burst Engine
 *   Step 6  OI Spurt Engine
 *
 * PART 2 — Advanced Analytics
 *   Step 7  Delta Shift Engine
 *   Step 8  Liquidity Sweep Engine
 *   Step 9  Liquidity Trap Engine
 *   Step 10 Block Trade Engine
 *   Step 11 Order Flow Engine
 *   Step 12 Option Strike Wall Engine
 *   Step 13 Gamma Exposure Engine
 *   Step 14 Unusual Option Activity Engine
 *   Step 15 Premium Flow Engine
 *
 * PART 3 — Trade Intelligence
 *   Step 16 Trade Score Engine
 *   Step 17 Probability Engine
 *   Step 18 Time Context Engine
 *   Step 19 Risk Management Engine
 *   Step 20 Signal Engine
 *   Step 21 Entry Exit Engine
 *   (Ranking via sort by TradeScore DESC)
 *
 * All data from MarketStateStore (real Dhan APIs) — no dummy data.
 */

import { marketStateStore, StockSnapshot } from './marketStateStore';

// ═══════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════

/** Per-sector aggregated data */
export interface SectorData {
  name: string;
  sectorChange: number;
  sectorVolume: number;
  avgSectorVolume: number;
  advancingStocks: number;
  decliningStocks: number;
  heatScore: number;
  topStock: string;
}

/** Market-level context */
export interface MarketContext {
  marketTrend: 'Bullish' | 'Bearish' | 'Neutral';
  indexChangePercent: number;
  niftyPrice: number;
  bankNiftyPrice: number;
  niftyChange: number;
  bankNiftyChange: number;
  vix: number;
  vwapStatus: 'Above VWAP' | 'Below VWAP' | 'At VWAP';
  gammaState: 'Positive' | 'Negative' | 'Neutral';
  totalGamma: number;
  marketPhase: string;
  timeStrength: 'Strong' | 'Moderate' | 'Weak';
}

/** Output from each engine */
export interface EngineOutput {
  id: number;
  name: string;
  status: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  value: string;
  detail: string;
  numericValue: number;
}

/** Trade signal for a stock */
export interface TradeSignal {
  symbol: string;
  sector: string;
  spotPrice: number;
  change: number;
  changePercent: number;
  volume: number;
  atmIV: number;
  pcr: number;
  signal: 'BUY' | 'SELL' | 'WATCH' | 'NEUTRAL' | 'IGNORE';
  tradeScore: number;
  probability: number;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  riskReward: number;
  oiInterpretation: string;
  engines: EngineOutput[];
  timestamp: number;
}

/** Smart Money row */
export interface SmartMoneyEntry {
  symbol: string;
  volumeRatio: number;
  oiSpurtPercent: number;
  blockTradeDetected: boolean;
  premiumFlowSignal: 'Strong' | 'Active' | 'Moderate' | 'Weak';
}

/** Liquidity signal */
export interface LiquiditySignal {
  symbol: string;
  event: 'Liquidity Sweep' | 'Liquidity Trap' | 'Order Flow Buy' | 'Order Flow Sell' | 'None';
  strength: 'Strong' | 'Medium' | 'Weak';
  detail: string;
}

/** Options positioning */
export interface OptionsPositioning {
  callWall: number;
  putWall: number;
  gammaExposure: 'Positive' | 'Negative' | 'Neutral';
  unusualActivity: boolean;
  deltaPressure: 'Call Buying' | 'Put Buying' | 'Neutral';
}

/** System status */
export interface SystemStatus {
  marketDataFeed: 'Active' | 'Delayed' | 'Inactive';
  apiStatus: 'OK' | 'Error';
  engineStatus: 'Running' | 'Stopped';
  latencyMs: number;
  lastUpdate: string;
  cacheAge: number;
  snapshotId: number;
}

/** Complete dashboard response */
export interface StockDashboardData {
  marketContext: MarketContext;
  sectors: SectorData[];
  smartMoney: SmartMoneyEntry[];
  optionsPositioning: OptionsPositioning;
  liquiditySignals: LiquiditySignal[];
  trades: TradeSignal[];
  systemStatus: SystemStatus;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
//  CACHES (for sweep/trap detection across refreshes)
// ═══════════════════════════════════════════════════════════════

const breakoutCache: Map<string, { price: number; time: number; direction: 'UP' | 'DOWN' }> = new Map();

// ═══════════════════════════════════════════════════════════════
//  PART 1 — DATA INGESTION & CORE MARKET ANALYTICS
// ═══════════════════════════════════════════════════════════════

/** STEP 1 — Data Validation Engine */
function step1_DataValidation(raw: StockSnapshot): { valid: boolean; engine: EngineOutput } {
  const priceOk = raw.spotPrice > 0;
  const volumeOk = raw.volume >= 0;
  const oiOk = raw.currentOI >= 0;
  const freshness = Date.now() - raw.timestamp;
  const freshOk = freshness < 15000;

  const valid = priceOk && volumeOk && oiOk && freshOk;
  return {
    valid,
    engine: {
      id: 1, name: 'Data Validation',
      status: valid ? 'BULLISH' : 'BEARISH',
      value: valid ? 'VALID' : 'INVALID',
      detail: !priceOk ? 'Price ≤ 0' : !volumeOk ? 'Vol < 0' : !oiOk ? 'OI < 0' : !freshOk ? `Stale ${(freshness / 1000).toFixed(1)}s` : 'OK',
      numericValue: valid ? 1 : 0,
    },
  };
}

/** STEP 2 — Pre Scanner Engine */
function step2_PreScanner(raw: StockSnapshot): { active: boolean; engine: EngineOutput } {
  const volumeRatio = raw.avgVolume > 0 ? raw.volume / raw.avgVolume : 0;
  const oiChangePct = raw.previousOI > 0 ? ((raw.currentOI - raw.previousOI) / raw.previousOI) * 100 : 0;
  const priceChange = raw.previousClose > 0 ? ((raw.spotPrice - raw.previousClose) / raw.previousClose) * 100 : 0;

  const active = volumeRatio > 1.3 || oiChangePct > 5 || Math.abs(priceChange) > 0.8;
  return {
    active,
    engine: {
      id: 2, name: 'Pre Scanner',
      status: active ? 'BULLISH' : 'NEUTRAL',
      value: active ? 'ACTIVE' : 'FILTERED',
      detail: `VolR=${volumeRatio.toFixed(1)}x OI%=${oiChangePct.toFixed(1)}% Px%=${priceChange.toFixed(2)}%`,
      numericValue: active ? 1 : 0,
    },
  };
}

/** STEP 3 — Market Trend Engine */
function step3_MarketTrend(ctx: MarketContext): EngineOutput {
  return {
    id: 3, name: 'Market Trend',
    status: ctx.marketTrend === 'Bullish' ? 'BULLISH' : ctx.marketTrend === 'Bearish' ? 'BEARISH' : 'NEUTRAL',
    value: ctx.marketTrend,
    detail: `Index ${ctx.indexChangePercent >= 0 ? '+' : ''}${ctx.indexChangePercent.toFixed(2)}% ${ctx.vwapStatus}`,
    numericValue: ctx.marketTrend === 'Bullish' ? 1 : ctx.marketTrend === 'Bearish' ? -1 : 0,
  };
}

/** STEP 4 — Sector Rotation Engine */
function step4_SectorRotation(sectorData: SectorData, indexChangePct: number): EngineOutput {
  const rs = sectorData.sectorChange - indexChangePct;
  const status: EngineOutput['status'] = sectorData.heatScore > 1 ? 'BULLISH' : sectorData.heatScore < -1 ? 'BEARISH' : 'NEUTRAL';
  return {
    id: 4, name: 'Sector Rotation',
    status,
    value: `Heat: ${sectorData.heatScore.toFixed(2)}`,
    detail: `${sectorData.name} RS=${rs.toFixed(2)} A/D=${sectorData.advancingStocks}/${sectorData.decliningStocks}`,
    numericValue: sectorData.heatScore,
  };
}

/** STEP 5 — Volume Burst Engine */
function step5_VolumeBurst(raw: StockSnapshot): { burst: boolean; volumeRatio: number; engine: EngineOutput } {
  const volumeRatio = raw.avgVolume > 0 ? raw.volume / raw.avgVolume : 0;
  const burst = volumeRatio > 1.5;
  return {
    burst, volumeRatio,
    engine: {
      id: 5, name: 'Volume Burst',
      status: burst ? 'BULLISH' : 'NEUTRAL',
      value: `${volumeRatio.toFixed(1)}x avg`,
      detail: burst ? 'Unusual volume' : 'Normal',
      numericValue: volumeRatio,
    },
  };
}

/** STEP 6 — OI Spurt Engine */
function step6_OISpurt(raw: StockSnapshot): { spurt: boolean; oiSpurtPct: number; oiInterp: string; engine: EngineOutput } {
  const oiSpurtPct = raw.previousOI > 0 ? ((raw.currentOI - raw.previousOI) / raw.previousOI) * 100 : 0;
  const spurt = oiSpurtPct > 10;
  const priceUp = raw.spotPrice > raw.previousClose;
  const oiUp = raw.currentOI > raw.previousOI;

  let interp = 'Neutral';
  if (priceUp && oiUp) interp = 'Call OI Increase';
  else if (!priceUp && oiUp) interp = 'Put OI Increase';
  else if (priceUp && !oiUp) interp = 'buy back';
  else if (!priceUp && !oiUp) interp = 'profit booking';

  const status: EngineOutput['status'] = (interp === 'Call OI Increase' || interp === 'buy back') ? 'BULLISH'
    : (interp === 'Put OI Increase' || interp === 'profit booking') ? 'BEARISH' : 'NEUTRAL';

  return {
    spurt, oiSpurtPct, oiInterp: interp,
    engine: {
      id: 6, name: 'OI Spurt',
      status,
      value: `${oiSpurtPct >= 0 ? '+' : ''}${oiSpurtPct.toFixed(1)}%`,
      detail: interp,
      numericValue: oiSpurtPct,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
//  PART 2 — ADVANCED ANALYTICS ENGINES
// ═══════════════════════════════════════════════════════════════

/** STEP 7 — Delta Shift Engine */
function step7_DeltaShift(raw: StockSnapshot): EngineOutput {
  const shift = raw.atmDelta - raw.prevDelta;
  const sig = Math.abs(shift) > 0.07;
  return {
    id: 7, name: 'Delta Shift',
    status: sig ? (shift > 0 ? 'BULLISH' : 'BEARISH') : 'NEUTRAL',
    value: `Δ=${shift >= 0 ? '+' : ''}${shift.toFixed(4)}`,
    detail: sig ? (shift > 0 ? 'Call buying' : 'Put buying') : 'No shift',
    numericValue: shift,
  };
}

/** STEP 8 — Liquidity Sweep Engine */
function step8_LiquiditySweep(raw: StockSnapshot): { swept: boolean; volSpike: number; engine: EngineOutput } {
  const volSpike = raw.avgVolume > 0 ? raw.volume / raw.avgVolume : 0;
  const breakoutUp = raw.spotPrice >= raw.dayHigh && raw.dayHigh > 0;
  const breakoutDown = raw.spotPrice <= raw.dayLow && raw.dayLow > 0;
  const swept = volSpike > 2 && (breakoutUp || breakoutDown);

  if (swept) {
    breakoutCache.set(raw.symbol, { price: raw.spotPrice, time: Date.now(), direction: breakoutUp ? 'UP' : 'DOWN' });
  }

  return {
    swept, volSpike,
    engine: {
      id: 8, name: 'Liquidity Sweep',
      status: swept ? 'BULLISH' : 'NEUTRAL',
      value: swept ? (breakoutUp ? 'Sweep UP' : 'Sweep DOWN') : 'None',
      detail: `VolSpike=${volSpike.toFixed(1)}x`,
      numericValue: swept ? volSpike : 0,
    },
  };
}

/** STEP 9 — Liquidity Trap Engine */
function step9_LiquidityTrap(raw: StockSnapshot): { trapped: boolean; trapStrength: number; engine: EngineOutput } {
  const bo = breakoutCache.get(raw.symbol);
  let trapped = false;
  let trapStrength = 0;

  if (bo) {
    const elapsed = (Date.now() - bo.time) / 60000;
    const returned = bo.direction === 'UP' ? raw.spotPrice < bo.price : raw.spotPrice > bo.price;
    const volSpike = raw.avgVolume > 0 ? raw.volume / raw.avgVolume : 0;

    if (returned && elapsed <= 5 && volSpike > 2) {
      trapped = true;
      trapStrength = volSpike + (Math.abs(bo.price - raw.spotPrice) / (bo.price || 1)) * 100;
      breakoutCache.delete(raw.symbol);
    }
    if (elapsed > 10) breakoutCache.delete(raw.symbol);
  }

  return {
    trapped, trapStrength,
    engine: {
      id: 9, name: 'Liquidity Trap',
      status: trapped ? 'BEARISH' : 'NEUTRAL',
      value: trapped ? `Trap (${trapStrength.toFixed(1)})` : 'None',
      detail: trapped ? 'Price returned inside level ≤5 min' : '-',
      numericValue: trapStrength,
    },
  };
}

/** STEP 10 — Block Trade Engine */
function step10_BlockTrade(raw: StockSnapshot): { detected: boolean; engine: EngineOutput } {
  const detected = raw.maxSingleTradeValue > 50_000_000;
  return {
    detected,
    engine: {
      id: 10, name: 'Block Trade',
      status: detected ? 'BULLISH' : 'NEUTRAL',
      value: detected ? `₹${(raw.maxSingleTradeValue / 10_000_000).toFixed(1)}Cr` : 'None',
      detail: detected ? 'Institutional trade' : '-',
      numericValue: detected ? 1 : 0,
    },
  };
}

/** STEP 11 — Order Flow Engine */
function step11_OrderFlow(raw: StockSnapshot): { imbalance: number; engine: EngineOutput } {
  const buy = raw.totalCallVolume || 1;
  const sell = raw.totalPutVolume || 1;
  const imbalance = buy / sell;

  let label = 'Neutral';
  let status: EngineOutput['status'] = 'NEUTRAL';
  if (imbalance > 1.5) { label = 'Strong buying'; status = 'BULLISH'; }
  else if (imbalance > 1.0) { label = 'Moderate buying'; status = 'BULLISH'; }
  else if (imbalance >= 0.7) { label = 'Mild selling'; status = 'BEARISH'; }
  else { label = 'Strong selling'; status = 'BEARISH'; }

  return {
    imbalance,
    engine: {
      id: 11, name: 'Order Flow',
      status,
      value: `${imbalance.toFixed(2)}`,
      detail: label,
      numericValue: imbalance,
    },
  };
}

/** STEP 12 — Option Strike Wall Engine */
function step12_StrikeWall(raw: StockSnapshot): EngineOutput {
  return {
    id: 12, name: 'Strike Wall',
    status: raw.callWallStrike > raw.spotPrice ? 'BEARISH' : 'BULLISH',
    value: `C:${raw.callWallStrike} P:${raw.putWallStrike}`,
    detail: `Range ${raw.putWallStrike}–${raw.callWallStrike}`,
    numericValue: 0,
  };
}

/** STEP 13 — Gamma Exposure Engine */
function step13_GammaExposure(raw: StockSnapshot): EngineOutput {
  const gexM = raw.totalGammaExposure / 1_000_000;
  return {
    id: 13, name: 'Gamma Exposure',
    status: raw.totalGammaExposure > 0 ? 'BULLISH' : raw.totalGammaExposure < 0 ? 'BEARISH' : 'NEUTRAL',
    value: `GEX: ${gexM.toFixed(2)}M`,
    detail: raw.totalGammaExposure > 0 ? 'Positive — mean revert' : raw.totalGammaExposure < 0 ? 'Negative — vol expand' : 'Neutral',
    numericValue: raw.totalGammaExposure,
  };
}

/** STEP 14 — Unusual Option Activity Engine */
function step14_UnusualActivity(raw: StockSnapshot): { unusual: boolean; engine: EngineOutput } {
  const optVol = raw.totalCallVolume + raw.totalPutVolume;
  const volRatio = raw.avgVolume > 0 ? optVol / raw.avgVolume : 0;
  const unusual = volRatio > 3 && raw.totalPremiumValue > 5_000_000;
  return {
    unusual,
    engine: {
      id: 14, name: 'Unusual Activity',
      status: unusual ? 'BULLISH' : 'NEUTRAL',
      value: unusual ? 'DETECTED' : 'Normal',
      detail: `OptVolR=${volRatio.toFixed(1)}x Prem=₹${(raw.totalPremiumValue / 100_000).toFixed(0)}L`,
      numericValue: unusual ? 1 : 0,
    },
  };
}

/** STEP 15 — Premium Flow Engine */
function step15_PremiumFlow(raw: StockSnapshot): { flowSignal: SmartMoneyEntry['premiumFlowSignal']; engine: EngineOutput } {
  const p = raw.totalPremiumValue;
  let flowSignal: SmartMoneyEntry['premiumFlowSignal'] = 'Weak';
  if (p > 75_000_000) flowSignal = 'Strong';
  else if (p > 50_000_000) flowSignal = 'Active';
  else if (p > 25_000_000) flowSignal = 'Moderate';

  return {
    flowSignal,
    engine: {
      id: 15, name: 'Premium Flow',
      status: flowSignal === 'Strong' || flowSignal === 'Active' ? 'BULLISH' : 'NEUTRAL',
      value: flowSignal,
      detail: `₹${(p / 100_000).toFixed(0)}L`,
      numericValue: p,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
//  PART 3 — TRADE INTELLIGENCE LAYER
// ═══════════════════════════════════════════════════════════════

/** STEP 16 — Trade Score Engine (0-100) */
function step16_TradeScore(s: {
  sector: number; volume: number; oi: number; delta: number;
  block: number; orderFlow: number; premium: number; sweep: number;
}): number {
  return s.sector * 0.15 + s.volume * 0.15 + s.oi * 0.15 + s.delta * 0.10
    + s.block * 0.10 + s.orderFlow * 0.10 + s.premium * 0.15 + s.sweep * 0.10;
}

/** STEP 17 — Probability Engine */
function step17_Probability(score: number, volR: number, oiPct: number, imbalance: number): number {
  return Math.min(score / 100, 1) * 0.4
    + Math.min(volR / 3, 1) * 0.2
    + Math.min(oiPct / 20, 1) * 0.2
    + Math.min(imbalance / 2, 1) * 0.2;
}

/** STEP 18 — Time Context Engine */
function step18_TimeContext(): { strength: 'Strong' | 'Moderate' | 'Weak'; phase: string; multiplier: number } {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const totalMin = ist.getHours() * 60 + ist.getMinutes();

  if (totalMin >= 570 && totalMin <= 630) return { strength: 'Strong', phase: 'Opening Session', multiplier: 1.2 };
  if (totalMin >= 840 && totalMin <= 915) return { strength: 'Strong', phase: 'Closing Session', multiplier: 1.2 };
  if (totalMin >= 630 && totalMin <= 840) return { strength: 'Moderate', phase: 'Mid-Day', multiplier: 1.0 };
  if (totalMin < 555 || totalMin > 930) return { strength: 'Weak', phase: 'Pre/Post Market', multiplier: 0.5 };
  return { strength: 'Moderate', phase: 'Regular Hours', multiplier: 1.0 };
}

/** STEP 19 — Risk Management Engine */
function step19_Risk(entry: number, atr: number, isBuy: boolean): { stopLoss: number; posSize: number } {
  const sl = isBuy ? entry - atr : entry + atr;
  const risk = Math.abs(entry - sl);
  const maxRisk = 1_000_000 * 0.01;
  return { stopLoss: sl, posSize: risk > 0 ? Math.floor(maxRisk / risk) : 0 };
}

/** STEP 20 — Signal Engine */
function step20_Signal(trend: string, pxChg: number, oiInterp: string, imbalance: number, score: number):
  'BUY' | 'SELL' | 'WATCH' | 'NEUTRAL' | 'IGNORE' {
  if (trend === 'Bullish' && pxChg > 0.6
    && (oiInterp === 'Call OI Increase' || oiInterp === 'buy back')
    && imbalance > 1.5 && score > 60) return 'BUY';
  if (trend === 'Bearish' && pxChg < -0.6
    && (oiInterp === 'Put OI Increase' || oiInterp === 'profit booking')
    && imbalance < 0.7 && score > 60) return 'SELL';
  if (score >= 55) return 'WATCH';
  if (score >= 40) return 'NEUTRAL';
  return 'IGNORE';
}

/** STEP 21 — Entry / Exit Engine */
function step21_Targets(entry: number, atr: number, isBuy: boolean) {
  const dir = isBuy ? 1 : -1;
  return {
    target1: entry + dir * 1.5 * atr,
    target2: entry + dir * 2 * atr,
    target3: entry + dir * 3 * atr,
    stopLoss: entry - dir * atr,
  };
}

// ═══════════════════════════════════════════════════════════════
//  SECTOR AGGREGATION
// ═══════════════════════════════════════════════════════════════

function aggregateSectors(allRaw: StockSnapshot[], indexChgPct: number): SectorData[] {
  const sMap = new Map<string, StockSnapshot[]>();
  for (const r of allRaw) {
    if (!sMap.has(r.sector)) sMap.set(r.sector, []);
    sMap.get(r.sector)!.push(r);
  }

  const sectors: SectorData[] = [];
  for (const [name, stocks] of sMap) {
    let adv = 0, dec = 0, tChg = 0, tVol = 0, tAvg = 0;
    let topStock = '', topChg = -Infinity;

    for (const s of stocks) {
      const chg = s.previousClose > 0 ? ((s.spotPrice - s.previousClose) / s.previousClose) * 100 : 0;
      tChg += chg; tVol += s.volume; tAvg += s.avgVolume;
      if (chg > 0) adv++; else dec++;
      if (chg > topChg) { topChg = chg; topStock = s.symbol; }
    }

    const secChg = stocks.length > 0 ? tChg / stocks.length : 0;
    const rs = secChg - indexChgPct;
    const vf = tAvg > 0 ? tVol / tAvg : 1;
    const ad = dec > 0 ? adv / dec : adv > 0 ? 2 : 1;
    const heat = secChg * 0.4 + rs * 0.3 + vf * 0.2 + ad * 0.1;

    sectors.push({
      name, sectorChange: Number(secChg.toFixed(2)),
      sectorVolume: tVol, avgSectorVolume: tAvg,
      advancingStocks: adv, decliningStocks: dec,
      heatScore: Number(heat.toFixed(2)), topStock,
    });
  }

  sectors.sort((a, b) => b.heatScore - a.heatScore);
  return sectors;
}

// ═══════════════════════════════════════════════════════════════
//  MAIN SERVICE (reads from cache — instant response)
// ═══════════════════════════════════════════════════════════════

class StockDashboardService {

  async getDashboard(): Promise<StockDashboardData> {
    const t0 = Date.now();

    // Read from MarketStateStore cache — NO API calls, instant
    const snapshot = marketStateStore.getSnapshot();

    if (!snapshot.isReady) {
      return this.emptyDashboard();
    }

    const marketContext = this.buildMarketContext(snapshot);
    const allRaw: StockSnapshot[] = Array.from(snapshot.stocks.values());

    const sectors = aggregateSectors(allRaw, marketContext.indexChangePercent);
    const top3Sectors = sectors.slice(0, 3).map(s => s.name);
    const timeCtx = step18_TimeContext();

    const trades: TradeSignal[] = [];
    const smartMoney: SmartMoneyEntry[] = [];
    const liquiditySignals: LiquiditySignal[] = [];
    let optPos: OptionsPositioning = {
      callWall: 0, putWall: 0,
      gammaExposure: 'Neutral', unusualActivity: false, deltaPressure: 'Neutral',
    };

    for (const raw of allRaw) {
      const { valid, engine: e1 } = step1_DataValidation(raw);
      if (!valid && raw.spotPrice <= 0) continue;

      const { engine: e2 } = step2_PreScanner(raw);
      const e3 = step3_MarketTrend(marketContext);
      const sec = sectors.find(s => s.name === raw.sector);
      const e4: EngineOutput = sec
        ? step4_SectorRotation(sec, marketContext.indexChangePercent)
        : { id: 4, name: 'Sector Rotation', status: 'NEUTRAL', value: '-', detail: '-', numericValue: 0 };
      const inTop3 = top3Sectors.includes(raw.sector);

      const { burst, volumeRatio, engine: e5 } = step5_VolumeBurst(raw);
      const { spurt, oiSpurtPct, oiInterp, engine: e6 } = step6_OISpurt(raw);
      const e7 = step7_DeltaShift(raw);
      const { swept, volSpike, engine: e8 } = step8_LiquiditySweep(raw);
      const { trapped, trapStrength, engine: e9 } = step9_LiquidityTrap(raw);
      const { detected: blockDet, engine: e10 } = step10_BlockTrade(raw);
      const { imbalance, engine: e11 } = step11_OrderFlow(raw);
      const e12 = step12_StrikeWall(raw);
      const e13 = step13_GammaExposure(raw);
      const { unusual, engine: e14 } = step14_UnusualActivity(raw);
      const { flowSignal, engine: e15 } = step15_PremiumFlow(raw);

      const tradeScore = step16_TradeScore({
        sector: inTop3 ? Math.min((sec?.heatScore || 0) * 30, 100) : 20,
        volume: Math.min(volumeRatio * 40, 100),
        oi: Math.min(Math.abs(oiSpurtPct) * 5, 100),
        delta: Math.abs(e7.numericValue) > 0.07 ? 80 : 30,
        block: blockDet ? 90 : 10,
        orderFlow: imbalance > 1.5 ? 80 : imbalance < 0.7 ? 80 : 40,
        premium: flowSignal === 'Strong' ? 90 : flowSignal === 'Active' ? 70 : flowSignal === 'Moderate' ? 50 : 20,
        sweep: swept ? 80 : trapped ? 70 : 20,
      });
      const adjScore = Math.min(tradeScore * timeCtx.multiplier, 100);

      const pxChg = raw.previousClose > 0 ? ((raw.spotPrice - raw.previousClose) / raw.previousClose) * 100 : 0;
      const prob = step17_Probability(adjScore, volumeRatio, Math.abs(oiSpurtPct), imbalance);
      const signal = step20_Signal(marketContext.marketTrend, pxChg, oiInterp, imbalance, adjScore);

      const atr = raw.dayHigh > 0 && raw.dayLow > 0 && raw.dayHigh !== raw.dayLow
        ? raw.dayHigh - raw.dayLow : raw.spotPrice * 0.015;
      const isBuy = signal === 'BUY';
      const { stopLoss } = step19_Risk(raw.spotPrice, atr, isBuy);
      const tgts = step21_Targets(raw.spotPrice, atr, isBuy);
      const rr = Math.abs(raw.spotPrice - stopLoss) > 0
        ? Math.abs(tgts.target1 - raw.spotPrice) / Math.abs(raw.spotPrice - stopLoss) : 0;

      trades.push({
        symbol: raw.symbol, sector: raw.sector, spotPrice: raw.spotPrice,
        change: Number((raw.spotPrice - raw.previousClose).toFixed(2)),
        changePercent: Number(pxChg.toFixed(2)),
        volume: raw.volume, atmIV: raw.atmIV, pcr: raw.pcr,
        signal, tradeScore: Number(adjScore.toFixed(0)),
        probability: Number(prob.toFixed(2)),
        entryPrice: raw.spotPrice,
        stopLoss: Number(stopLoss.toFixed(2)),
        target1: Number(tgts.target1.toFixed(2)),
        target2: Number(tgts.target2.toFixed(2)),
        target3: Number(tgts.target3.toFixed(2)),
        riskReward: Number(rr.toFixed(2)),
        oiInterpretation: oiInterp,
        engines: [e1, e2, e3, e4, e5, e6, e7, e8, e9, e10, e11, e12, e13, e14, e15],
        timestamp: raw.timestamp,
      });

      if (burst || spurt || blockDet || flowSignal !== 'Weak') {
        smartMoney.push({
          symbol: raw.symbol,
          volumeRatio: Number(volumeRatio.toFixed(1)),
          oiSpurtPercent: Number(oiSpurtPct.toFixed(1)),
          blockTradeDetected: blockDet,
          premiumFlowSignal: flowSignal,
        });
      }

      if (swept) liquiditySignals.push({ symbol: raw.symbol, event: 'Liquidity Sweep', strength: volSpike > 3 ? 'Strong' : 'Medium', detail: `${volSpike.toFixed(1)}x vol spike` });
      if (trapped) liquiditySignals.push({ symbol: raw.symbol, event: 'Liquidity Trap', strength: trapStrength > 5 ? 'Strong' : 'Medium', detail: `Strength ${trapStrength.toFixed(1)}` });
      if (imbalance > 1.5) liquiditySignals.push({ symbol: raw.symbol, event: 'Order Flow Buy', strength: imbalance > 2 ? 'Strong' : 'Medium', detail: `Imbalance ${imbalance.toFixed(2)}` });
      else if (imbalance < 0.7) liquiditySignals.push({ symbol: raw.symbol, event: 'Order Flow Sell', strength: imbalance < 0.5 ? 'Strong' : 'Medium', detail: `Imbalance ${imbalance.toFixed(2)}` });

      if (raw.callWallStrike > optPos.callWall) optPos.callWall = raw.callWallStrike;
      if (raw.putWallStrike > optPos.putWall || optPos.putWall === 0) optPos.putWall = raw.putWallStrike;
      if (unusual) optPos.unusualActivity = true;
    }

    const totGex = allRaw.reduce((s, r) => s + r.totalGammaExposure, 0);
    optPos.gammaExposure = totGex > 0 ? 'Positive' : totGex < 0 ? 'Negative' : 'Neutral';
    const avgDS = allRaw.reduce((s, r) => s + (r.atmDelta - r.prevDelta), 0) / (allRaw.length || 1);
    optPos.deltaPressure = avgDS > 0.03 ? 'Call Buying' : avgDS < -0.03 ? 'Put Buying' : 'Neutral';

    trades.sort((a, b) => b.tradeScore - a.tradeScore);

    const latency = Date.now() - t0;
    const cacheAge = Date.now() - snapshot.timestamp;

    return {
      marketContext, sectors, smartMoney, optionsPositioning: optPos,
      liquiditySignals, trades,
      systemStatus: {
        marketDataFeed: cacheAge < 10000 ? 'Active' : cacheAge < 30000 ? 'Delayed' : 'Inactive',
        apiStatus: 'OK', engineStatus: 'Running',
        latencyMs: latency,
        lastUpdate: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }),
        cacheAge,
        snapshotId: snapshot.snapshotId,
      },
      timestamp: Date.now(),
    };
  }

  private buildMarketContext(snapshot: import('./marketStateStore').MarketStateSnapshot): MarketContext {
    const nifty = snapshot.indices.get('NIFTY');
    const bnf = snapshot.indices.get('BANKNIFTY');
    const niftyPrice = nifty?.price || 0;
    const bnfPrice = bnf?.price || 0;
    const nChg = nifty?.changePercent || 0;
    const bChg = bnf?.changePercent || 0;

    const trend: MarketContext['marketTrend'] = nChg > 0 ? 'Bullish' : nChg < 0 ? 'Bearish' : 'Neutral';
    const tc = step18_TimeContext();

    const allStocks = Array.from(snapshot.stocks.values());
    const totalGamma = allStocks.reduce((s, r) => s + r.totalGammaExposure, 0);

    return {
      marketTrend: trend, indexChangePercent: Number(nChg.toFixed(2)),
      niftyPrice, bankNiftyPrice: bnfPrice,
      niftyChange: Number(nChg.toFixed(2)), bankNiftyChange: Number(bChg.toFixed(2)),
      vix: snapshot.vix,
      vwapStatus: nChg > 0 ? 'Above VWAP' : nChg < 0 ? 'Below VWAP' : 'At VWAP',
      gammaState: totalGamma > 0 ? 'Positive' : totalGamma < 0 ? 'Negative' : 'Neutral',
      totalGamma,
      marketPhase: tc.phase, timeStrength: tc.strength,
    };
  }

  private emptyDashboard(): StockDashboardData {
    return {
      marketContext: {
        marketTrend: 'Neutral', indexChangePercent: 0,
        niftyPrice: 0, bankNiftyPrice: 0, niftyChange: 0, bankNiftyChange: 0,
        vix: 14, vwapStatus: 'At VWAP', gammaState: 'Neutral', totalGamma: 0,
        marketPhase: 'Initializing', timeStrength: 'Weak',
      },
      sectors: [], smartMoney: [],
      optionsPositioning: { callWall: 0, putWall: 0, gammaExposure: 'Neutral', unusualActivity: false, deltaPressure: 'Neutral' },
      liquiditySignals: [], trades: [],
      systemStatus: {
        marketDataFeed: 'Inactive', apiStatus: 'OK', engineStatus: 'Running',
        latencyMs: 0, lastUpdate: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }),
        cacheAge: 0, snapshotId: 0,
      },
      timestamp: Date.now(),
    };
  }
}

export const stockDashboardService = new StockDashboardService();
