/**
 * Maps live scanner + range output into pipeline MarketDataSnapshot (real data only).
 */

import type { ScanResult, StrikeTrade } from './scannerEngine';
import type { MarketDataSnapshot } from './engines/pipeline';
import type { ScannerModelOutput } from './engines/decisionEngine';
import { classifySetup } from './setupClassifier';
import { type RangeOutput, type RangeEngineInput } from './engines/constants';
import { computeRange, classifyPosition, calculateOverlap } from './engines/rangeEngine';
import { marketRangeService } from './marketRangeService';

function pickBestTrade(scan: ScanResult): StrikeTrade | null {
  const c = scan.topCalls[0];
  const p = scan.topPuts[0];
  if (c && !p) return c;
  if (p && !c) return p;
  if (c && p) return c.entryScore >= p.entryScore ? c : p;
  return null;
}

function scanToScannerModel(scan: ScanResult, best: StrikeTrade | null): ScannerModelOutput | null {
  if (scan.signal === 'NO TRADE' || !best) {
    return null;
  }

  // Long option (CE or PE): execution / PnL uses BUY for premium long
  const sig: 'BUY' | 'SELL' = 'BUY';

  const m = scan.market;
  const htf = m.trendDirection;
  const mtf = m.multiTFScore >= 2 ? htf : m.multiTFScore === 1 ? htf : 'NEUTRAL';
  const ltf = mtf;

  let deltaLabel = 'NEUTRAL';
  if (best.delta > 0.45) deltaLabel = 'BULLISH';
  else if (best.delta < -0.45 || best.optionType === 'PE') deltaLabel = best.delta < 0.35 ? 'BEARISH' : 'NEUTRAL';

  return {
    signal: sig,
    entryScore: best.entryScore,
    winProb: best.winProbability,
    rr: best.riskReward,
    flowScore: best.flowScore,
    flowAlign: best.flowScore >= 1 || best.institutionalFlow || best.freshPosition,
    htfDirection: htf,
    mtfDirection: typeof mtf === 'string' ? mtf : 'NEUTRAL',
    ltfDirection: typeof ltf === 'string' ? ltf : 'NEUTRAL',
    indexDirection: htf,
    overlap: 0,
    confidence: scan.score,
    delta: deltaLabel,
    marketStructure: m.marketStructure,
  };
}

/**
 * Build full pipeline snapshot from scanner result + range service.
 * Returns null if data insufficient for simulation path.
 */
export async function buildPipelineSnapshotFromScan(scan: ScanResult): Promise<MarketDataSnapshot | null> {
  const symbol = scan.symbol.toUpperCase();
  const best = pickBestTrade(scan);
  const scannerSignal = scanToScannerModel(scan, best);
  if (!scannerSignal || !best) return null;

  const rangeData = await marketRangeService.getIndexRangeData(symbol).catch(() => null);
  if (!rangeData) return null;

  const tf = rangeData.daily;
  const spotPrice = rangeData.spotPrice || scan.spotPrice;
  const atrHigh = tf.atr.highRange;
  const atrLow = tf.atr.lowRange;
  const emHigh = tf.expectedMove.upperBound;
  const emLow = tf.expectedMove.lowerBound;
  const atrWidth = tf.atr.rangeWidth;
  const emWidth = emHigh - emLow;

  const atrPos = classifyPosition(spotPrice, atrHigh, atrLow);
  const emPos = classifyPosition(spotPrice, emHigh, emLow);
  const overlap = calculateOverlap(atrHigh, atrLow, emHigh, emLow);

  const rangeInput: RangeEngineInput = {
    atrPosition: atrPos,
    emPosition: emPos,
    overlap,
    atrWidth,
    emWidth,
    rangeType: 'DAILY',
    spotPrice,
  };
  const rangeOutput: RangeOutput = computeRange(rangeInput);

  scannerSignal.overlap = overlap;

  const optionEntryPrice = Math.max(best.entryPrice, 0.05);
  const stopLoss = Math.max(best.stopLoss, 0.01);
  const target = Math.max(best.targetPrice, optionEntryPrice * 1.01);

  const spreadPct = best.bidAskSpreadPct ?? 0.5;
  const spread = (optionEntryPrice * spreadPct) / 100;

  const setupType = classifySetup(scan, rangeOutput);

  const triggerData = {
    gammaWall: scan.gammaPressure[0]?.strike ?? scan.strikeRecommendation,
    gammaWallBroken: scan.market.marketStructure === 'BREAKOUT_PREP',
    gammaFlipDetected: false,
    momentumSpike: best.volumeAcceleration > 0,
    volumeSurge: best.volumeRatio > 1.15,
    priceRetesting: rangeOutput.tradeZone === 'WAIT',
    levelHolding: true,
    retestLevel: scan.strikeRecommendation,
    structureBreak: scan.market.marketStructure === 'BREAKOUT_PREP',
    breakoutClosed: true,
  };

  const snap: MarketDataSnapshot = {
    symbol,
    spotPrice,
    atrHigh,
    atrLow,
    emHigh,
    emLow,
    atrWidth,
    emWidth,
    scannerSignal,
    triggerData,
    spread,
    volume: best.volume,
    openInterest: best.oi,
    volatility: best.iv || scan.market.indiaVIX,
    ltfCandleClosed: true,
    breakoutCandleSize: optionEntryPrice * 0.02,
    averageCandleSize: optionEntryPrice * 0.015,
    strike: best.strike,
    optionType: best.optionType,
    stopLoss,
    target,
    vix: scan.market.indiaVIX,
    vwap: scan.market.vwap,
    gamma: String(scan.gammaPressure[0]?.gammaScore ?? 0),
    timeStrength: `${scan.market.multiTFScore}/2`,
    marketState: scan.market.marketStructure,
    iv: best.iv || scan.market.indiaVIX,
    optionEntryPrice,
    setupType,
  };

  return snap;
}
