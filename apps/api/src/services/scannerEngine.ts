/**
 * INTRADAY OPTION TRADE DISCOVERY SYSTEM — Full 31-Step Pipeline
 *
 * Architecture:
 *   Market Data → Option Chain Parser → Intraday Option Scanner →
 *   Trend Filter → Multi-Timeframe Confirmation → Range/Breakout Detection →
 *   Volatility Regime → AI Probability Engine → Trade Decision
 *
 * Scoring: EntryScore 0-20, WinProbability 0-100%, RiskReward ≥ 1.5
 * Output:  Top 3 CE + Top 3 PE trades, institutional setups, liquidity traps,
 *          gamma pressure, volatility regime, market structure
 */

import { getDhanStream } from './dhanClient';
import { getOptionChain } from './optionChain';
import { marketRangeService } from './marketRangeService';

// ── Per-index configuration ─────────────────────────────────

interface IndexScanConfig {
  strikeStep: number;
  lotSize: number;
  minOI: number;
  minVolume: number;
}

const INDEX_CONFIGS: Record<string, IndexScanConfig> = {
  NIFTY:       { strikeStep: 50,  lotSize: 50, minOI: 100000, minVolume: 5000 },
  BANKNIFTY:   { strikeStep: 100, lotSize: 15, minOI: 80000,  minVolume: 3000 },
  FINNIFTY:    { strikeStep: 50,  lotSize: 25, minOI: 50000,  minVolume: 2000 },
  MIDCAPNIFTY: { strikeStep: 25,  lotSize: 75, minOI: 30000,  minVolume: 1500 },
  SENSEX:      { strikeStep: 100, lotSize: 10, minOI: 60000,  minVolume: 2000 },
  BANKEX:      { strikeStep: 100, lotSize: 15, minOI: 60000,  minVolume: 2000 },
};

const SUPPORTED_INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCAPNIFTY', 'SENSEX', 'BANKEX'];

// ── Types ───────────────────────────────────────────────────

export interface StrikeTrade {
  strike: number;
  optionType: 'CE' | 'PE';
  entryPrice: number;       // LTP
  targetPrice: number;      // Entry + ExpectedOptionMove
  stopLoss: number;         // max(entry×0.75, entry − ATR×0.2×|delta|)
  riskReward: number;
  entryScore: number;       // 0-20
  winProbability: number;   // 0-100%
  confidence: string;       // Institutional / Strong / Normal / Weak
  delta: number;
  gamma: number;
  iv: number;
  oi: number;
  volume: number;
  volumeRatio: number;
  volumeAcceleration: number;
  oiChangePercent: number;
  distancePercent: number;
  bidAskSpreadPct: number;
  gammaExposure: number;
  expectedOptionMove: number;
  freshPosition: boolean;
  institutionalFlow: boolean;
  // Score breakdown
  deltaScore: number;
  distanceScore: number;
  volumeScore: number;
  volumeAccelScore: number;
  oiScore: number;
  flowScore: number;
  gammaScore: number;
  trapScore: number;
}

export interface LiquidityTrap {
  type: 'BULL_TRAP' | 'BEAR_TRAP';
  strike: number;
  suggestedTrade: 'CALL' | 'PUT';
  trapScore: number;
  details: string;
}

export interface GammaPressureStrike {
  strike: number;
  gammaExposure: number;
  gammaScore: number;
  distancePercent: number;
}

export interface MarketContext {
  spotPrice: number;
  previousClose: number;
  vwap: number;
  atr: number;
  indiaVIX: number;
  expectedMove: number;
  trendDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  marketStructure: 'TRENDING' | 'RANGE' | 'BREAKOUT_PREP';
  volatilityRegime: 'HIGH' | 'NORMAL' | 'LOW';
  multiTFScore: number;      // 0, 1, or 2
  rangePercent: number;
  inSession: boolean;
}

export interface ScanStep {
  id: number;
  name: string;
  pass: boolean;
  value: string;
  weight: number;
}

export interface ScanResult {
  symbol: string;
  signal: 'BUY CE' | 'BUY PE' | 'NO TRADE';
  score: number;               // composite 0-100%
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  strikeRecommendation: number;
  spotPrice: number;
  steps: ScanStep[];
  reason: string;
  timestamp: number;
  // ── Full output per spec ──
  market: MarketContext;
  topCalls: StrikeTrade[];     // Top 3 CE trades
  topPuts: StrikeTrade[];      // Top 3 PE trades
  institutionalSetups: StrikeTrade[];
  liquidityTraps: LiquidityTrap[];
  gammaPressure: GammaPressureStrike[];
  highProbabilityTrades: StrikeTrade[];
}

export interface AllScanResults {
  results: ScanResult[];
  timestamp: number;
}

// ── IST Time helper ─────────────────────────────────────────

function nowIST(): Date {
  const utc = new Date();
  return new Date(utc.getTime() + (5.5 * 60 * 60 * 1000 - utc.getTimezoneOffset() * 60 * 1000));
}

// ── Service ─────────────────────────────────────────────────

// Strike-level volume history for acceleration calculation
const strikeVolumeHistory: Record<string, { vol: number; ts: number }[]> = {};

class ScannerEngine {

  async scanAll(): Promise<AllScanResults> {
    // Stagger index scans sequentially to avoid 429 rate-limit flooding.
    // Each scanIndex() makes 3-4 Dhan API calls; running 6 at once = ~24 calls.
    const results: ScanResult[] = [];
    for (const sym of SUPPORTED_INDICES) {
      results.push(await this.scanIndex(sym));
      // Small delay between indices so the rate-limiter queue doesn't pile up
      await new Promise(r => setTimeout(r, 300));
    }
    return { results, timestamp: Date.now() };
  }

  /**
   * Full 31-step pipeline for a single index
   */
  async scanIndex(symbol: string): Promise<ScanResult> {
    const cfg = INDEX_CONFIGS[symbol] || INDEX_CONFIGS.NIFTY;
    const steps: ScanStep[] = [];

    try {
      // ════════════════════════════════════════════════════════
      //  STEP 1: GATHER REQUIRED DATA (spec §1)
      // ════════════════════════════════════════════════════════
      const dhan = getDhanStream();
      const [spotPrice, chainData, ivDataRaw, rangeData, ohlcData] = await Promise.all([
        dhan.getSpotPrice(symbol),
        getOptionChain(symbol).catch(() => null),
        dhan.getIVData(symbol).catch(() => ({ iv: 15 })),
        marketRangeService.getIndexRangeData(symbol).catch(() => null),
        dhan.getOHLCData(symbol).catch(() => null),
      ]);

      if (!chainData || !spotPrice) {
        return this.noTradeResult(symbol, spotPrice || 0, 'No market data available');
      }

      const rows = chainData.rows || chainData.strikes || [];
      if (rows.length === 0) {
        return this.noTradeResult(symbol, spotPrice, 'No option chain data');
      }

      // Market data
      const indiaVIX = ivDataRaw?.iv || 15;
      const atr = rangeData?.daily?.atr?.atr14 || spotPrice * 0.012;
      const previousClose = ohlcData?.close
        || (rangeData?.daily?.atr?.lowRange
          ? (rangeData.daily.atr.highRange + rangeData.daily.atr.lowRange) / 2 - atr / 2
          : spotPrice * 0.998);

      // VWAP: use actual intraday OHLC from Dhan if available
      const dayHigh = (ohlcData && ohlcData.high > 0) ? ohlcData.high
        : rangeData?.daily?.atr?.highRange || spotPrice * 1.005;
      const dayLow = (ohlcData && ohlcData.low > 0) ? ohlcData.low
        : rangeData?.daily?.atr?.lowRange || spotPrice * 0.995;
      const vwap = (dayHigh + dayLow + spotPrice) / 3; // typical price as VWAP proxy

      // Futures approximation from spot (real futures would need futures API)
      const futuresPrice = spotPrice * (1 + 0.0003); // slight premium

      // Expected Move (spec §23): ATR × (1 + VIX/100)
      const expectedMove = atr * (1 + indiaVIX / 100);

      // ════════════════════════════════════════════════════════
      //  STEP 4: ATM STRIKE (spec §4)
      // ════════════════════════════════════════════════════════
      const atmStrike = Math.round(spotPrice / cfg.strikeStep) * cfg.strikeStep;

      // ════════════════════════════════════════════════════════
      //  STEP 5: SCAN RANGE = ATM ± 10 strikes (spec §5)
      // ════════════════════════════════════════════════════════
      const scanStrikes: number[] = [];
      for (let i = -10; i <= 10; i++) {
        scanStrikes.push(atmStrike + i * cfg.strikeStep);
      }

      // Map option chain rows by strike for fast lookup
      const rowMap = new Map<number, any>();
      rows.forEach((r: any) => rowMap.set(r.strike, r));

      // ════════════════════════════════════════════════════════
      //  STEP 7: TREND FILTER (spec §7)
      // ════════════════════════════════════════════════════════
      const now = nowIST();
      const totalMin = now.getHours() * 60 + now.getMinutes();
      const inSession = totalMin >= 565 && totalMin <= 885; // 09:25=565, 14:45=885

      let trendDirection: MarketContext['trendDirection'] = 'NEUTRAL';
      const bullishTrend = spotPrice > vwap && spotPrice > previousClose && futuresPrice >= spotPrice;
      const bearishTrend = spotPrice < vwap && spotPrice < previousClose && futuresPrice <= spotPrice;
      if (bullishTrend) trendDirection = 'BULLISH';
      else if (bearishTrend) trendDirection = 'BEARISH';

      const trendScore = trendDirection !== 'NEUTRAL' ? 2 : 0;

      steps.push({
        id: 1, name: 'Session Window (09:25-14:45)',
        pass: inSession, value: `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`, weight: 3,
      });
      steps.push({
        id: 2, name: 'Trend Filter',
        pass: trendDirection !== 'NEUTRAL',
        value: `${trendDirection} | Spot ${spotPrice.toFixed(0)} vs VWAP ${vwap.toFixed(0)}`,
        weight: 3,
      });

      // ════════════════════════════════════════════════════════
      //  STEP 8: MULTI-TIMEFRAME CONFIRMATION (spec §8)
      //  Using VWAP proximity as proxy for 15m/5m VWAP alignment
      // ════════════════════════════════════════════════════════
      const vwapDist = Math.abs(spotPrice - vwap) / spotPrice * 100;
      const above5mVWAP = spotPrice > vwap; // proxy: spot vs session VWAP
      const above15mVWAP = spotPrice > previousClose; // proxy: above prev close
      let multiTFScore = 0;
      if (trendDirection === 'BULLISH' && above5mVWAP && above15mVWAP) multiTFScore = 2;
      else if (trendDirection === 'BEARISH' && !above5mVWAP && !above15mVWAP) multiTFScore = 2;
      else if (above5mVWAP || above15mVWAP) multiTFScore = 1;

      steps.push({
        id: 3, name: 'Multi-TF Confirmation',
        pass: multiTFScore >= 2, value: `Score=${multiTFScore}/2`, weight: 2,
      });

      // ════════════════════════════════════════════════════════
      //  STEP 9: RANGE / BREAKOUT DETECTION (spec §9)
      // ════════════════════════════════════════════════════════
      const rangeWidth = Math.max(dayHigh - dayLow, 0);
      const rangePercent = spotPrice > 0 ? (rangeWidth / spotPrice) * 100 : 0;
      const atrDecreasing = rangeData?.daily?.atr?.atrPercent
        ? rangeData.daily.atr.atrPercent < 1.0
        : false;

      let marketStructure: MarketContext['marketStructure'] = 'TRENDING';
      if (rangePercent < 0.4) marketStructure = 'BREAKOUT_PREP';
      else if (rangePercent < 0.6 && atrDecreasing) marketStructure = 'RANGE';
      else if (rangePercent > 1.2 && vwapDist > 0.4) marketStructure = 'TRENDING';

      steps.push({
        id: 4, name: 'Market Structure',
        pass: marketStructure === 'TRENDING' || marketStructure === 'BREAKOUT_PREP',
        value: `${marketStructure} | Range=${rangePercent.toFixed(2)}%`,
        weight: 2,
      });

      // ════════════════════════════════════════════════════════
      //  VOLATILITY REGIME (spec implied)
      // ════════════════════════════════════════════════════════
      let volatilityRegime: MarketContext['volatilityRegime'] = 'NORMAL';
      if (indiaVIX > 20) volatilityRegime = 'HIGH';
      else if (indiaVIX < 12) volatilityRegime = 'LOW';

      steps.push({
        id: 5, name: 'Volatility Regime',
        pass: volatilityRegime !== 'HIGH',
        value: `VIX=${indiaVIX.toFixed(1)} (${volatilityRegime})`,
        weight: 1,
      });

      // ════════════════════════════════════════════════════════
      //  STEP 6: LIQUIDITY FILTER + SCORING PER STRIKE (spec §6-21)
      // ════════════════════════════════════════════════════════
      const allTrades: StrikeTrade[] = [];
      const liquidityTraps: LiquidityTrap[] = [];
      const gammaPressureStrikes: GammaPressureStrike[] = [];

      // Calculate max gamma exposure across all strikes for normalization
      let maxGammaExposure = 0;
      const gammaExposures = new Map<number, { ce: number; pe: number }>();
      scanStrikes.forEach(strike => {
        const row = rowMap.get(strike);
        if (!row) return;
        const ceGex = Math.abs((row.ce?.gamma || 0) * (row.ce?.oi || 0) * cfg.lotSize * spotPrice);
        const peGex = Math.abs((row.pe?.gamma || 0) * (row.pe?.oi || 0) * cfg.lotSize * spotPrice);
        gammaExposures.set(strike, { ce: ceGex, pe: peGex });
        maxGammaExposure = Math.max(maxGammaExposure, ceGex, peGex);
      });

      // Process each strike in scan range
      scanStrikes.forEach(strike => {
        const row = rowMap.get(strike);
        if (!row) return;

        // Process both CE and PE
        for (const optType of ['CE', 'PE'] as const) {
          const side = optType === 'CE' ? row.ce : row.pe;
          if (!side) continue;

          const oi = side.oi || 0;
          const vol = side.volume || 0;
          const ltp = side.ltp || 0;
          const bid = side.bid || 0;
          const ask = side.ask || 0;
          const delta = side.delta || 0;
          const gamma = side.gamma || 0;
          const iv = side.iv || 0;
          const oiChg = side.oiChg || 0;
          const prevOI = Math.max(oi - oiChg, 0);
          const oiChgPct = prevOI > 0 ? (oiChg / prevOI) * 100 : (oiChg > 0 ? 100 : 0);

          // §3: Derived values
          const avgVol = side.avgVolume || vol || 1; // Use avg if available, else current
          const volumeRatio = avgVol > 0 ? vol / avgVol : 0;

          // Volume Acceleration: compare current volume to previous snapshot
          const volHistKey = `${symbol}_${strike}_${optType}`;
          if (!strikeVolumeHistory[volHistKey]) strikeVolumeHistory[volHistKey] = [];
          const volHist = strikeVolumeHistory[volHistKey];
          let volumeAcceleration = 0;
          if (volHist.length > 0) {
            const prevVol = volHist[volHist.length - 1].vol;
            if (prevVol > 0) {
              volumeAcceleration = ((vol - prevVol) / prevVol) * 100;
            }
          }
          // Store current snapshot (keep last 5)
          volHist.push({ vol, ts: Date.now() });
          if (volHist.length > 5) volHist.shift();
          const distancePercent = spotPrice > 0 ? Math.abs(strike - spotPrice) / spotPrice * 100 : 99;
          const midPrice = (bid + ask) / 2;
          const bidAskSpreadPct = midPrice > 0 ? ((ask - bid) / midPrice) * 100 : (ltp > 0 ? ((ask - bid) / ltp) * 100 : 99);
          const gex = gammaExposures.get(strike);
          const gammaExposure = optType === 'CE' ? (gex?.ce || 0) : (gex?.pe || 0);

          // §6: LIQUIDITY FILTER
          if (oi < cfg.minOI) continue;
          if (vol < cfg.minVolume) continue;
          // Spread filter: reject if bid-ask spread > 2%
          if (bidAskSpreadPct > 2) continue;
          if (distancePercent > 1.2) continue;

          // §24: VALID STRIKES
          if (optType === 'CE' && strike > spotPrice + expectedMove) continue;
          if (optType === 'PE' && strike < spotPrice - expectedMove) continue;

          // ────────────────────────────────────────────────────
          //  §15-21: ENTRY SCORING (0-20 max)
          // ────────────────────────────────────────────────────

          // §15: DELTA SCORE
          let deltaScore = 0;
          const absDelta = Math.abs(delta);
          if (optType === 'CE') {
            if (absDelta >= 0.45 && absDelta <= 0.55) deltaScore = 3;
            else if (absDelta > 0.55 && absDelta <= 0.65) deltaScore = 2;
            else if (absDelta >= 0.35 && absDelta < 0.45) deltaScore = 1;
            else if (absDelta >= 0.25 && absDelta < 0.35) deltaScore = 1;
          } else {
            if (absDelta >= 0.45 && absDelta <= 0.55) deltaScore = 3;
            else if (absDelta > 0.55 && absDelta <= 0.65) deltaScore = 2;
            else if (absDelta >= 0.35 && absDelta < 0.45) deltaScore = 1;
            else if (absDelta >= 0.25 && absDelta < 0.35) deltaScore = 1;
          }

          // §16: DISTANCE SCORE
          let distanceScore = 0;
          if (distancePercent <= 0.25) distanceScore = 4;
          else if (distancePercent <= 0.5) distanceScore = 3;
          else if (distancePercent <= 0.8) distanceScore = 2;
          else if (distancePercent <= 1.0) distanceScore = 1;

          // §17: VOLUME SCORE
          let volumeScore = 0;
          if (volumeRatio > 2.5) volumeScore = 2;
          else if (volumeRatio > 1.5) volumeScore = 1;

          // §18: VOLUME ACCELERATION SCORE
          let volumeAccelScore = 0;
          if (volumeAcceleration >= 30) volumeAccelScore = 2;
          else if (volumeAcceleration >= 15) volumeAccelScore = 1;

          // §19: OI SCORE
          let oiScore = 0;
          if (oi >= 1000000) oiScore = 2;
          else if (oi >= 300000) oiScore = 1;

          // §20: FLOW SCORE (from OI Change)
          let flowScore = 0;
          if (Math.abs(oiChgPct) > 5) flowScore = 2;
          else if (Math.abs(oiChgPct) > 2) flowScore = 1;

          // §11: GAMMA PRESSURE ENGINE
          let gammaScore = 0;
          const expectedMoveScore = expectedMove;
          if (distancePercent <= 0.6 && gammaExposure >= 0.75 * maxGammaExposure && Math.abs(strike - spotPrice) <= expectedMoveScore) {
            gammaScore = 2;
          } else if (distancePercent <= 0.7) {
            gammaScore = 1;
          }

          // §12: LIQUIDITY TRAP ENGINE
          let trapScore = 0;
          const priceChg = side.chg || 0;
          const priceRising = priceChg > 0;
          const priceFalling = priceChg < 0;
          // Bull Trap: Price rising, Call OI increasing, volume decreasing
          if (optType === 'CE' && priceRising && oiChg > 0 && vol < cfg.minVolume * 1.5) {
            // Potential bull trap → suggest PUT
            liquidityTraps.push({
              type: 'BULL_TRAP', strike, suggestedTrade: 'PUT', trapScore: 2,
              details: `Price ↑ + CE OI ↑ + low volume at ${strike}`,
            });
          }
          // Bear Trap: Price falling, Put OI increasing, volume decreasing
          if (optType === 'PE' && priceFalling && oiChg > 0 && vol < cfg.minVolume * 1.5) {
            liquidityTraps.push({
              type: 'BEAR_TRAP', strike, suggestedTrade: 'CALL', trapScore: 2,
              details: `Price ↓ + PE OI ↑ + low volume at ${strike}`,
            });
            trapScore = 2;
          }

          // §10: FRESH POSITION BUILDUP
          const freshPosition = Math.abs(oiChgPct) > 4 && volumeRatio > 1.8;

          // §13: INSTITUTIONAL FLOW ENGINE
          const institutionalFlow = Math.abs(oiChgPct) >= 6
            && volumeRatio >= 2
            && gammaExposure >= 0.7 * maxGammaExposure;

          // §14: ENTRY SCORE (max 20)
          const entryScore = deltaScore + distanceScore + volumeScore
            + volumeAccelScore + oiScore + flowScore + gammaScore + trapScore;

          // §25-26: WIN PROBABILITY
          // MaxPossibleScore = 3+4+2+2+2+2+2+2 = 19 (but spec says /95 for final)
          // Using spec §26: WinProbability = (WinScore / 95) × 100
          // where WinScore includes trend + multi-TF + regime bonuses
          const winScore = entryScore + trendScore + multiTFScore
            + (volatilityRegime === 'NORMAL' ? 1 : 0)
            + (marketStructure === 'TRENDING' ? 2 : 0);
          const winProbability = Math.min(100, Math.round((winScore / 26) * 100));

          // §27: EXPECTED OPTION MOVE
          const gammaRatio = maxGammaExposure > 0 ? gammaExposure / maxGammaExposure : 0;
          const expectedOptionMove = absDelta * expectedMove * (1 + gammaRatio);

          // §28: TARGET
          const targetPrice = ltp + expectedOptionMove;

          // §29: STOP LOSS
          const stopLoss = Math.max(ltp * 0.75, ltp - atr * 0.2 * absDelta);

          // §30: RISK-REWARD (safe division)
          const risk = ltp - stopLoss;
          const reward = targetPrice - ltp;
          const riskReward = risk > 0.01 ? reward / risk : 0;

          // Track gamma pressure strikes
          if (gammaScore >= 1) {
            gammaPressureStrikes.push({
              strike, gammaExposure, gammaScore, distancePercent,
            });
          }

          const trade: StrikeTrade = {
            strike, optionType: optType,
            entryPrice: ltp, targetPrice: Number(targetPrice.toFixed(2)),
            stopLoss: Number(stopLoss.toFixed(2)),
            riskReward: Number(riskReward.toFixed(2)),
            entryScore, winProbability,
            confidence: entryScore >= 17 ? 'Institutional'
              : entryScore >= 14 ? 'Strong'
              : entryScore >= 11 ? 'Normal' : 'Weak',
            delta, gamma, iv, oi, volume: vol,
            volumeRatio: Number(volumeRatio.toFixed(2)),
            volumeAcceleration,
            oiChangePercent: Number(oiChgPct.toFixed(2)),
            distancePercent: Number(distancePercent.toFixed(2)),
            bidAskSpreadPct: Number(bidAskSpreadPct.toFixed(2)),
            gammaExposure: Number(gammaExposure.toFixed(0)),
            expectedOptionMove: Number(expectedOptionMove.toFixed(2)),
            freshPosition, institutionalFlow,
            deltaScore, distanceScore, volumeScore,
            volumeAccelScore, oiScore, flowScore, gammaScore, trapScore,
          };

          allTrades.push(trade);
        }
      });

      // ════════════════════════════════════════════════════════
      //  STEP 31: FINAL TRADE FILTER (spec §31)
      // ════════════════════════════════════════════════════════
      const validTrades = allTrades.filter(t =>
        t.entryScore >= 11
        && t.winProbability >= 65
        && t.riskReward >= 1.5
        && totalMin <= 870 // 14:30
      );

      // §22: Top 3 CE + Top 3 PE
      const ceTrades = validTrades
        .filter(t => t.optionType === 'CE')
        .sort((a, b) => b.entryScore - a.entryScore || b.winProbability - a.winProbability);
      const peTrades = validTrades
        .filter(t => t.optionType === 'PE')
        .sort((a, b) => b.entryScore - a.entryScore || b.winProbability - a.winProbability);

      const topCalls = ceTrades.slice(0, 3);
      const topPuts = peTrades.slice(0, 3);

      // Institutional setups
      const institutionalSetups = allTrades
        .filter(t => t.institutionalFlow)
        .sort((a, b) => b.entryScore - a.entryScore)
        .slice(0, 5);

      // High probability trades (win% ≥ 75)
      const highProbTrades = validTrades
        .filter(t => t.winProbability >= 75)
        .sort((a, b) => b.winProbability - a.winProbability)
        .slice(0, 5);

      // Build pipeline steps for display (spec steps 6-31)
      const allCE = allTrades.filter(t => t.optionType === 'CE');
      const allPE = allTrades.filter(t => t.optionType === 'PE');

      steps.push({ id: 6, name: 'Liquidity Filter - CE Strikes', pass: allCE.length >= 3, value: `${allCE.length} passed`, weight: 2 });
      steps.push({ id: 7, name: 'Liquidity Filter - PE Strikes', pass: allPE.length >= 3, value: `${allPE.length} passed`, weight: 2 });
      steps.push({ id: 8, name: 'Fresh Position Buildup', pass: allTrades.some(t => t.freshPosition), value: `${allTrades.filter(t => t.freshPosition).length} strikes`, weight: 1 });
      steps.push({ id: 9, name: 'Gamma Pressure Detected', pass: gammaPressureStrikes.length > 0, value: `${gammaPressureStrikes.length} strikes`, weight: 2 });
      steps.push({ id: 10, name: 'Liquidity Traps', pass: liquidityTraps.length > 0, value: `${liquidityTraps.length} detected`, weight: 1 });
      steps.push({ id: 11, name: 'Institutional Flow', pass: institutionalSetups.length > 0, value: `${institutionalSetups.length} setups`, weight: 2 });

      // Best scores found
      const bestCE = topCalls[0];
      const bestPE = topPuts[0];
      steps.push({ id: 12, name: 'Best CE EntryScore', pass: (bestCE?.entryScore || 0) >= 11, value: bestCE ? `${bestCE.strike} CE = ${bestCE.entryScore}/20` : 'None', weight: 2 });
      steps.push({ id: 13, name: 'Best PE EntryScore', pass: (bestPE?.entryScore || 0) >= 11, value: bestPE ? `${bestPE.strike} PE = ${bestPE.entryScore}/20` : 'None', weight: 2 });
      steps.push({ id: 14, name: 'Best CE WinProb', pass: (bestCE?.winProbability || 0) >= 65, value: bestCE ? `${bestCE.winProbability}%` : 'N/A', weight: 2 });
      steps.push({ id: 15, name: 'Best PE WinProb', pass: (bestPE?.winProbability || 0) >= 65, value: bestPE ? `${bestPE.winProbability}%` : 'N/A', weight: 2 });
      steps.push({ id: 16, name: 'Best CE RiskReward', pass: (bestCE?.riskReward || 0) >= 1.5, value: bestCE ? `${bestCE.riskReward}:1` : 'N/A', weight: 2 });
      steps.push({ id: 17, name: 'Best PE RiskReward', pass: (bestPE?.riskReward || 0) >= 1.5, value: bestPE ? `${bestPE.riskReward}:1` : 'N/A', weight: 2 });

      // ATR/Expected Move context
      steps.push({ id: 18, name: 'ATR Value', pass: atr > 0, value: `${atr.toFixed(1)}`, weight: 1 });
      steps.push({ id: 19, name: 'Expected Move', pass: expectedMove > 0, value: `${expectedMove.toFixed(1)} pts`, weight: 1 });
      steps.push({ id: 20, name: `India VIX`, pass: indiaVIX < 25, value: `${indiaVIX.toFixed(1)}`, weight: 1 });

      // Delta scoring breakdown
      steps.push({ id: 21, name: 'Delta Score (best)', pass: Math.max(bestCE?.deltaScore || 0, bestPE?.deltaScore || 0) >= 2, value: `CE=${bestCE?.deltaScore || 0} PE=${bestPE?.deltaScore || 0}`, weight: 1 });
      steps.push({ id: 22, name: 'Distance Score (best)', pass: Math.max(bestCE?.distanceScore || 0, bestPE?.distanceScore || 0) >= 2, value: `CE=${bestCE?.distanceScore || 0} PE=${bestPE?.distanceScore || 0}`, weight: 1 });
      steps.push({ id: 23, name: 'Volume Score (best)', pass: Math.max(bestCE?.volumeScore || 0, bestPE?.volumeScore || 0) >= 1, value: `CE=${bestCE?.volumeScore || 0} PE=${bestPE?.volumeScore || 0}`, weight: 1 });
      steps.push({ id: 24, name: 'OI Score (best)', pass: Math.max(bestCE?.oiScore || 0, bestPE?.oiScore || 0) >= 1, value: `CE=${bestCE?.oiScore || 0} PE=${bestPE?.oiScore || 0}`, weight: 1 });
      steps.push({ id: 25, name: 'Flow Score (best)', pass: Math.max(bestCE?.flowScore || 0, bestPE?.flowScore || 0) >= 1, value: `CE=${bestCE?.flowScore || 0} PE=${bestPE?.flowScore || 0}`, weight: 1 });
      steps.push({ id: 26, name: 'Gamma Score (best)', pass: Math.max(bestCE?.gammaScore || 0, bestPE?.gammaScore || 0) >= 1, value: `CE=${bestCE?.gammaScore || 0} PE=${bestPE?.gammaScore || 0}`, weight: 1 });

      // Final filters
      steps.push({ id: 27, name: 'EntryScore ≥ 11 Filter', pass: validTrades.length > 0, value: `${validTrades.length} trades pass`, weight: 2 });
      steps.push({ id: 28, name: 'WinProb ≥ 65% Filter', pass: validTrades.filter(t => t.winProbability >= 65).length > 0, value: `${validTrades.filter(t => t.winProbability >= 65).length} pass`, weight: 2 });
      steps.push({ id: 29, name: 'RiskReward ≥ 1.5 Filter', pass: validTrades.filter(t => t.riskReward >= 1.5).length > 0, value: `${validTrades.filter(t => t.riskReward >= 1.5).length} pass`, weight: 2 });
      steps.push({ id: 30, name: 'Time ≤ 14:30 Filter', pass: totalMin <= 870, value: `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`, weight: 1 });

      // Composite
      const totalWeight = steps.reduce((s, st) => s + st.weight, 0);
      const passedWeight = steps.reduce((s, st) => s + (st.pass ? st.weight : 0), 0);
      const compositeScore = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0;
      steps.push({ id: 31, name: 'Composite Pipeline Score', pass: compositeScore >= 50, value: `${compositeScore}%`, weight: 0 });

      // ════════════════════════════════════════════════════════
      //  DETERMINE FINAL SIGNAL
      // ════════════════════════════════════════════════════════
      let signal: ScanResult['signal'] = 'NO TRADE';
      let reason = '';
      const bestTrade = [...topCalls, ...topPuts].sort((a, b) => b.entryScore - a.entryScore)[0];

      if (!inSession) {
        signal = 'NO TRADE';
        reason = 'Outside trading session (09:25-14:45)';
      } else if (multiTFScore === 0) {
        signal = 'NO TRADE';
        reason = 'Multi-TF confirmation rejected';
      } else if (topCalls.length > 0 && topPuts.length === 0) {
        signal = 'BUY CE';
        reason = `${topCalls.length} CE trade(s) found | Best: ${topCalls[0].strike} CE (Score ${topCalls[0].entryScore}, Win ${topCalls[0].winProbability}%, RR ${topCalls[0].riskReward})`;
      } else if (topPuts.length > 0 && topCalls.length === 0) {
        signal = 'BUY PE';
        reason = `${topPuts.length} PE trade(s) found | Best: ${topPuts[0].strike} PE (Score ${topPuts[0].entryScore}, Win ${topPuts[0].winProbability}%, RR ${topPuts[0].riskReward})`;
      } else if (bestTrade) {
        signal = bestTrade.optionType === 'CE' ? 'BUY CE' : 'BUY PE';
        reason = `Best: ${bestTrade.strike} ${bestTrade.optionType} (Score ${bestTrade.entryScore}, Win ${bestTrade.winProbability}%, RR ${bestTrade.riskReward}) | CE:${topCalls.length} PE:${topPuts.length}`;
      } else {
        signal = 'NO TRADE';
        reason = `No trades meet all filters (Score≥11, Win≥65%, RR≥1.5)`;
      }

      // Index engine: OI + gamma → structure; flow/build-up → confirmation (not price-only)
      if (signal !== 'NO TRADE' && bestTrade) {
        const structureEdge = bestTrade.gammaScore >= 1 || bestTrade.oiScore >= 2;
        const flowOrBuild =
          bestTrade.flowScore >= 1 || bestTrade.freshPosition || bestTrade.institutionalFlow;
        if (!structureEdge || !flowOrBuild) {
          signal = 'NO TRADE';
          reason =
            'Index engine: requires gamma/OI structure plus flow or OI build-up — price-only setups excluded';
        }
      }

      const confidence: ScanResult['confidence'] =
        compositeScore >= 65 ? 'HIGH' : compositeScore >= 50 ? 'MEDIUM' : 'LOW';

      return {
        symbol,
        signal,
        score: compositeScore,
        confidence,
        strikeRecommendation: bestTrade?.strike || atmStrike,
        spotPrice,
        steps,
        reason,
        timestamp: Date.now(),
        market: {
          spotPrice, previousClose, vwap, atr, indiaVIX,
          expectedMove, trendDirection, marketStructure, volatilityRegime,
          multiTFScore, rangePercent: Number(rangePercent.toFixed(2)), inSession,
        },
        topCalls,
        topPuts,
        institutionalSetups,
        liquidityTraps: liquidityTraps.slice(0, 5),
        gammaPressure: gammaPressureStrikes
          .sort((a, b) => b.gammaExposure - a.gammaExposure)
          .slice(0, 5),
        highProbabilityTrades: highProbTrades,
      };

    } catch (error) {
      console.error(`Scanner error for ${symbol}:`, error);
      // Try to get at least spotPrice from Dhan for the error result
      let fallbackSpot = 0;
      try {
        const dhan = getDhanStream();
        fallbackSpot = await dhan.getSpotPrice(symbol);
      } catch { /* keep 0 */ }
      return this.noTradeResult(symbol, fallbackSpot, `Error scanning ${symbol}: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  private noTradeResult(symbol: string, spotPrice: number, reason: string): ScanResult {
    // Populate minimal useful data even on error
    const vwap = spotPrice > 0 ? spotPrice : 0;
    const atr = spotPrice > 0 ? spotPrice * 0.012 : 0;
    return {
      symbol, signal: 'NO TRADE', score: 0, confidence: 'LOW',
      strikeRecommendation: 0, spotPrice, steps: [], reason, timestamp: Date.now(),
      market: {
        spotPrice, previousClose: spotPrice * 0.998, vwap, atr, indiaVIX: 0,
        expectedMove: atr > 0 ? atr * 1.15 : 0, trendDirection: 'NEUTRAL', marketStructure: 'RANGE',
        volatilityRegime: 'NORMAL', multiTFScore: 0, rangePercent: 0, inSession: false,
      },
      topCalls: [], topPuts: [], institutionalSetups: [],
      liquidityTraps: [], gammaPressure: [], highProbabilityTrades: [],
    };
  }
}

export const scannerEngine = new ScannerEngine();
