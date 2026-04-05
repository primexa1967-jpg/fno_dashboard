/**
 * Append-only audit log for engine / pipeline (JSON lines file).
 */

import fs from 'fs/promises';
import path from 'path';

const DIR = path.join(__dirname, '../../storage/engine');
const AUDIT_FILE = path.join(DIR, 'audit.jsonl');

export interface AuditEntry {
  ts: string;
  type: string;
  [key: string]: unknown;
}

export function appendEngineAudit(entry: Omit<AuditEntry, 'ts'> & { type: string }): void {
  const line: AuditEntry = { ts: new Date().toISOString(), ...entry };
  void (async () => {
    try {
      await fs.mkdir(DIR, { recursive: true });
      await fs.appendFile(AUDIT_FILE, `${JSON.stringify(line)}\n`, 'utf-8');
    } catch (e) {
      console.error('engineAudit: append failed', e);
    }
  })();
}

export async function readEngineAuditLines(maxLines: number = 200): Promise<AuditEntry[]> {
  try {
    const buf = await fs.readFile(AUDIT_FILE, 'utf-8');
    const lines = buf.trim().split('\n').filter(Boolean);
    const slice = lines.slice(-maxLines);
    return slice.map((l) => JSON.parse(l) as AuditEntry);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}
