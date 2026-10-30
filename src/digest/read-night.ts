import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus, StatusCounts } from './types.js';

type LogLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isStatus(value: unknown): value is RunStatus {
  return value === 'ok' || value === 'retry' || value === 'fail';
}

// The edge: everything past this function trusts LogLine. null means a bad line.
function parseLine(text: string): LogLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;

  const { at, job, status, owner, error } = value as Record<string, unknown>;
  if (typeof at !== 'string' || !TIMESTAMP.test(at) || Number.isNaN(Date.parse(at))) return null;
  if (!isFilled(job) || !isStatus(status)) return null;
  if (owner !== null && !isFilled(owner)) return null;
  if (error !== undefined && !isFilled(error)) return null;

  return { at, job, status, owner, ...(error === undefined ? {} : { error }) };
}

function readLog(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return { found: false };

  const log = readLog(join(runsDir, `${night}.jsonl`));
  if (log === null) return { found: false };

  const rows = new Map<string, DigestRow>();
  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const text of log.split('\n')) {
    if (text.trim() === '') continue;

    const line = parseLine(text);
    if (line === null) {
      badLines += 1;
      continue;
    }

    counts[line.status] += 1;
    const row: DigestRow = rows.get(line.job) ?? {
      job: line.job,
      owner: line.owner,
      runs: 0,
      retries: 0,
      lastStatus: line.status,
      lastError: null,
      firstAt: line.at,
      lastAt: line.at,
    };
    row.owner = line.owner;
    row.runs += 1;
    if (line.status === 'retry') row.retries += 1;
    row.lastStatus = line.status;
    if (line.error !== undefined) row.lastError = line.error;
    row.lastAt = line.at;
    rows.set(line.job, row);
  }

  // Code-unit order, not localeCompare: the same on every machine.
  const sorted = [...rows.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { found: true, rows: sorted, badLines, counts };
};
