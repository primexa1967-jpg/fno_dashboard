/**
 * Historical win-rate gate per setup + symbol (spec §5A).
 */

import { simulationEngine } from './engines/simulationEngine';
const MIN_SAMPLES = 3;
const REJECT_BELOW = 60;
const UPGRADE_AT = 75;

export interface ProbabilityGateResult {
  allowed: boolean;
  reason: string;
  winRate: number | null;
  sampleSize: number;
  upgradeStrength: boolean;
}

export function evaluateProbabilityGate(
  symbol: string,
  setupType: string | undefined
): ProbabilityGateResult {
  if (!setupType) {
    return {
      allowed: true,
      reason: 'No setup type — skip probability gate',
      winRate: null,
      sampleSize: 0,
      upgradeStrength: false,
    };
  }

  const sym = symbol.toUpperCase();
  const closed = simulationEngine.getClosedTrades(2000);
  const relevant = closed.filter(
    (t) =>
      t.symbol === sym &&
      t.setupType === setupType &&
      t.status === 'CLOSED' &&
      t.exitTime != null
  );

  if (relevant.length < MIN_SAMPLES) {
    return {
      allowed: true,
      reason: `Insufficient history (${relevant.length} < ${MIN_SAMPLES}) — gate skipped`,
      winRate: null,
      sampleSize: relevant.length,
      upgradeStrength: false,
    };
  }

  const wins = relevant.filter((t) => (t.realizedPnl ?? 0) > 0).length;
  const winRate = (wins / relevant.length) * 100;

  if (winRate < REJECT_BELOW) {
    return {
      allowed: false,
      reason: `Win rate ${winRate.toFixed(1)}% < ${REJECT_BELOW}% for ${setupType} on ${sym} (n=${relevant.length})`,
      winRate,
      sampleSize: relevant.length,
      upgradeStrength: false,
    };
  }

  return {
    allowed: true,
    reason: `Win rate ${winRate.toFixed(1)}% (n=${relevant.length})`,
    winRate,
    sampleSize: relevant.length,
    upgradeStrength: winRate >= UPGRADE_AT,
  };
}
