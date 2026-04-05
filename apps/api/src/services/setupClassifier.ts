/**
 * Classify setup type for historical win-rate tracking (spec §5A).
 */

import type { ScanResult } from './scannerEngine';
import { TRADE_ZONE, type RangeOutput } from './engines/constants';

export type SetupType = 'BREAKOUT' | 'RETEST' | 'GAMMA' | 'FLOW' | 'MOMENTUM';

export function classifySetup(scan: ScanResult, rangeOutput: RangeOutput | null): SetupType {
  const struct = scan.market?.marketStructure;
  const gp = scan.gammaPressure?.[0];
  if (gp && gp.gammaExposure > 0) return 'GAMMA';
  if (struct === 'BREAKOUT_PREP') return 'BREAKOUT';
  const best = [...scan.topCalls, ...scan.topPuts].sort(
    (a, b) => b.entryScore - a.entryScore
  )[0];
  if (best) {
    if (best.flowScore >= 2 || best.institutionalFlow) return 'FLOW';
    if (best.volumeAcceleration > 0 || best.volumeRatio > 1.2) return 'MOMENTUM';
  }
  if (rangeOutput?.tradeZone === TRADE_ZONE.WAIT) return 'RETEST';
  return 'MOMENTUM';
}
