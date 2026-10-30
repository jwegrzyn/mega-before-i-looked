import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';
import type { Night } from '../src/digest/types.js';

function found(result: ReturnType<typeof readNight>): Night {
  if (!result.found) throw new Error('expected the night to be found');
  return result;
}

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = found(readNight('runs', '2026-10-28'));
  const row = (job: string) => night.rows.find((r) => r.job === job);

  it('finds 5 jobs and 1 bad line, sorted by job', () => {
    expect(night.badLines).toBe(1);
    expect(night.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('counts runs and retries for lane/sync', () => {
    expect(row('lane/sync')).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok', owner: 'rook' });
  });

  it('keeps the last error of fixtures/refresh although it ended ok', () => {
    expect(row('fixtures/refresh')).toMatchObject({
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
    });
  });

  it('reports the failure of notes/backup', () => {
    expect(row('notes/backup')).toMatchObject({
      runs: 1,
      retries: 0,
      lastStatus: 'fail',
      lastError: 'quota exceeded',
    });
  });

  it('keeps digest/render with a null owner and no error', () => {
    expect(row('digest/render')).toMatchObject({ owner: null, lastError: null });
  });

  it('keeps times as written, with their offset', () => {
    expect(row('fixtures/refresh')).toMatchObject({
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('counts valid lines per status', () => {
    expect(night.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });
});

describe('readNight on a temp runs dir', () => {
  const NIGHT = '2026-01-02';
  let dir: string;

  const write = (lines: string, file = `${NIGHT}.jsonl`) => {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, lines);
  };
  const line = (fields: Record<string, unknown>) =>
    JSON.stringify({ at: '2026-01-02T01:00:00+01:00', job: 'a', status: 'ok', owner: 'rook', ...fields });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('tells a missing file from an empty one', () => {
    expect(readNight(dir, NIGHT)).toEqual({ found: false });
    write('');
    expect(readNight(dir, NIGHT)).toEqual({
      found: true,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('treats a missing runs dir as no file', () => {
    expect(readNight(join(dir, 'nope'), NIGHT)).toEqual({ found: false });
  });

  it('keeps a row whose owner is null', () => {
    write(`${line({ owner: null })}\n`);
    const { rows, badLines } = found(readNight(dir, NIGHT));
    expect(badLines).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.owner).toBeNull();
  });

  it.each([
    ['not JSON', '{"at":'],
    ['a JSON number', '5'],
    ['JSON null', 'null'],
    ['a JSON array', '[]'],
    ['no at', line({ at: undefined })],
    ['an at that is not a time', line({ at: 'yesterday' })],
    ['an at without an offset', line({ at: '2026-01-02T01:00:00' })],
    ['an impossible at', line({ at: '2026-13-45T01:00:00+01:00' })],
    ['no job', line({ job: undefined })],
    ['an empty job', line({ job: '' })],
    ['a job that is not a string', line({ job: 7 })],
    ['an unknown status', line({ status: 'maybe' })],
    ['no owner', line({ owner: undefined })],
    ['an owner that is not a string', line({ owner: 7 })],
    ['an error that is not a string', line({ error: 503 })],
  ])('counts %s as a bad line and keeps the rest', (_name, bad) => {
    write(`${line({})}\n${bad}\n${line({ status: 'fail' })}\n`);
    const { rows, badLines, counts } = found(readNight(dir, NIGHT));
    expect(badLines).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runs: 2, lastStatus: 'fail' });
    expect(counts).toEqual({ ok: 1, retry: 0, fail: 1 });
  });

  it('does not count blank lines', () => {
    write(`\n${line({})}\n\n   \n`);
    const { rows, badLines } = found(readNight(dir, NIGHT));
    expect(badLines).toBe(0);
    expect(rows[0]?.runs).toBe(1);
  });

  it('takes first and last in file order, not time order, and never converts', () => {
    write(
      [
        line({ at: '2026-01-02T05:00:00+01:00' }),
        line({ at: '2026-01-02T01:00:00-05:00' }),
        line({ at: '2026-01-02T03:00:00+01:00' }),
      ].join('\n'),
    );
    expect(found(readNight(dir, NIGHT)).rows[0]).toMatchObject({
      firstAt: '2026-01-02T05:00:00+01:00',
      lastAt: '2026-01-02T03:00:00+01:00',
    });
  });

  it('takes the owner from the last line of the job', () => {
    write(`${line({ owner: 'rook' })}\n${line({ owner: null })}\n`);
    expect(found(readNight(dir, NIGHT)).rows[0]?.owner).toBeNull();
  });

  it('keeps the most recent error when several were seen', () => {
    write(`${line({ error: 'first' })}\n${line({ error: 'second' })}\n${line({})}\n`);
    expect(found(readNight(dir, NIGHT)).rows[0]?.lastError).toBe('second');
  });

  it('sorts by job whatever the order in the file', () => {
    write(`${line({ job: 'b' })}\n${line({ job: 'B' })}\n${line({ job: 'a' })}\n`);
    expect(found(readNight(dir, NIGHT)).rows.map((r) => r.job)).toEqual(['B', 'a', 'b']);
  });

  it.each([
    '../secret',
    '../2026-01-02',
    '..%2F2026-01-02',
    '2026-01-02/../../secret',
    '2026-01-02\n',
    '2026-1-2',
    '2026-01-02.jsonl',
    '',
  ])('treats the night %j as no file, even when the path exists', (night) => {
    const runs = join(dir, 'runs');
    write('', 'secret.jsonl');
    write('', '2026-01-02.jsonl');
    write(`${line({})}\n`, 'runs/2026-01-02.jsonl');
    expect(readNight(runs, night)).toEqual({ found: false });
  });
});
