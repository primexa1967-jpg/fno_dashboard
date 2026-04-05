/**
 * Persists simulation + risk engine state to disk (survives API restarts).
 * Plain JSON under storage/engine/ — no circular imports with simulationEngine.
 */

import fs from 'fs/promises';
import path from 'path';
import type { TradeObject, RejectionEntry } from './engines/constants';
import type { RiskState } from './engines/riskEngine';

const STORAGE_DIR = path.join(__dirname, '../../storage/engine');
const SNAPSHOT_FILE = path.join(STORAGE_DIR, 'simulation_snapshot.json');

export interface EngineSnapshotPayload {
  simulation: {
    openTrades: TradeObject[];
    closedTrades: TradeObject[];
    rejections: RejectionEntry[];
    tradeCounter: number;
    mode: string;
  };
  risk: {
    state: RiskState;
    symbolConsecutiveLosses: [string, number][];
  };
}

interface FileShape {
  version: number;
  savedAt: string;
  simulation: EngineSnapshotPayload['simulation'];
  risk: EngineSnapshotPayload['risk'];
}

let persistChain: Promise<void> = Promise.resolve();

async function ensureDir(): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
}

/**
 * Queue a save so concurrent mutations serialize to one writer.
 */
export function persistEngineSnapshot(payload: EngineSnapshotPayload): void {
  persistChain = persistChain.then(() => writeSnapshot(payload)).catch((e) => {
    console.error('enginePersistence: save failed', e);
  });
}

async function writeSnapshot(payload: EngineSnapshotPayload): Promise<void> {
  await ensureDir();
  const body: FileShape = {
    version: 1,
    savedAt: new Date().toISOString(),
    simulation: payload.simulation,
    risk: payload.risk,
  };
  const tmp = `${SNAPSHOT_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(body, null, 2), 'utf-8');
  await fs.rename(tmp, SNAPSHOT_FILE);
}

export async function loadEngineSnapshot(): Promise<EngineSnapshotPayload | null> {
  try {
    const raw = await fs.readFile(SNAPSHOT_FILE, 'utf-8');
    const data = JSON.parse(raw) as FileShape;
    if (!data.simulation || !data.risk) return null;
    return { simulation: data.simulation, risk: data.risk };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.error('enginePersistence: load failed', e);
    return null;
  }
}

/** Call once after DB init — restores paper trades and risk capital state */
export async function hydrateEnginesFromDisk(): Promise<void> {
  const snap = await loadEngineSnapshot();
  if (!snap) {
    console.log('enginePersistence: no snapshot — starting fresh simulation state');
    return;
  }
  const { riskEngine } = await import('./engines/riskEngine');
  const { simulationEngine } = await import('./engines/simulationEngine');
  riskEngine.importStateSnapshot(snap.risk);
  simulationEngine.hydrateFromSnapshot({
    openTrades: snap.simulation.openTrades,
    closedTrades: snap.simulation.closedTrades,
    rejections: snap.simulation.rejections,
    tradeCounter: snap.simulation.tradeCounter,
    mode: snap.simulation.mode as 'SIMULATION' | 'LIVE',
  });
  console.log(
    `enginePersistence: restored ${snap.simulation.openTrades.length} open / ${snap.simulation.closedTrades.length} closed simulated trades`
  );
}
