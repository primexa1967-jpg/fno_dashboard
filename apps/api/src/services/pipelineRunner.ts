/**
 * Scheduled end-to-end pipeline: real scanner → range → decision → probability →
 * trigger → risk → simulated execution; updates open trade marks; runs exits.
 */

import { healthEngine } from './engines/healthEngine';
import { scannerEngine } from './scannerEngine';
import { getOptionChain } from './optionChain';
import { pipelineOrchestrator } from './engines/pipeline';
import { simulationEngine } from './engines/simulationEngine';
import { buildPipelineSnapshotFromScan } from './pipelineScanMapper';
import { SUPPORTED_INDICES } from './engines/constants';
import { appendEngineAudit } from './engineAudit';
import type { OptionChainRow } from '@option-dashboard/shared';

const DEFAULT_INTERVAL_MS = Number(process.env.ENGINE_PIPELINE_INTERVAL_MS || 45000);
let runnerTimer: NodeJS.Timeout | null = null;
let runningTick = false;

function ltpForTrade(row: OptionChainRow | undefined, optionType: 'CE' | 'PE'): number {
  if (!row) return 0;
  return optionType === 'CE' ? (row.ce?.ltp ?? 0) : (row.pe?.ltp ?? 0);
}

/**
 * Refresh mark-to-market for open simulated positions using latest option chain.
 */
async function updateOpenTradePrices(symbol: string): Promise<void> {
  try {
    const chain = await getOptionChain(symbol.toLowerCase()).catch(() => null);
    if (!chain?.rows?.length) return;
    const rowMap = new Map<number, (typeof chain.rows)[0]>();
    for (const r of chain.rows) {
      if (r.strike != null) rowMap.set(r.strike, r);
    }
    const open = simulationEngine.getOpenTrades().filter((t) => t.symbol === symbol.toUpperCase());
    for (const t of open) {
      const row = rowMap.get(t.strike);
      const ltp = ltpForTrade(row, t.optionType);
      if (ltp > 0) {
        simulationEngine.updateTrade(t.tradeId, ltp);
      }
    }
  } catch (e) {
    console.warn(`pipelineRunner: price update failed for ${symbol}`, e);
  }
}

export async function runPipelineCycleOnce(): Promise<void> {
  if (runningTick) return;
  runningTick = true;
  const started = Date.now();
  try {
    healthEngine.recordTick();

    await pipelineOrchestrator.runExitCycle();

    for (const sym of SUPPORTED_INDICES) {
      await updateOpenTradePrices(sym);

      const hasOpen = simulationEngine.getOpenTrades().some((t) => t.symbol === sym);
      if (hasOpen) continue;

      const scan = await scannerEngine.scanIndex(sym);
      const snap = await buildPipelineSnapshotFromScan(scan);
      if (!snap) continue;

      const result = await pipelineOrchestrator.runPipeline(snap);
      if (result.trade) {
        appendEngineAudit({
          type: 'PIPELINE_OPEN',
          symbol: sym,
          tradeId: result.trade.tradeId,
          setupType: snap.setupType,
          ms: Date.now() - started,
        });
      }
    }
  } catch (e) {
    console.error('pipelineRunner: cycle error', e);
    appendEngineAudit({
      type: 'PIPELINE_ERROR',
      error: String(e),
      ms: Date.now() - started,
    });
  } finally {
    if (simulationEngine.getOpenTrades().length > 0) {
      simulationEngine.flushStateToDisk();
    }
    runningTick = false;
  }
}

export function startPipelineRunner(): void {
  if (process.env.ENGINE_PIPELINE_ENABLED === 'false') {
    console.log('⏸️  ENGINE_PIPELINE_ENABLED=false — scheduled pipeline disabled');
    return;
  }
  if (runnerTimer) return;
  console.log(`🚀 Pipeline runner every ${DEFAULT_INTERVAL_MS}ms (set ENGINE_PIPELINE_INTERVAL_MS to change)`);
  void runPipelineCycleOnce();
  runnerTimer = setInterval(() => {
    void runPipelineCycleOnce();
  }, DEFAULT_INTERVAL_MS);
}

export function stopPipelineRunner(): void {
  if (runnerTimer) {
    clearInterval(runnerTimer);
    runnerTimer = null;
  }
}
