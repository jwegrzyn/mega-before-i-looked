import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

let runsDir = '';
let app: ReturnType<typeof createApp>;

const line = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify({ at, job, status, owner, ...(error ? { error } : {}) });

function night(name: string, lines: string[]) {
  writeFileSync(join(runsDir, `${name}.jsonl`), lines.length ? `${lines.join('\n')}\n` : '');
}

// Table rows of the page, one string per <tr>.
const rowsOf = (html: string) => html.split(/<tr[\s>]/).slice(1);
const rowFor = (html: string, job: string) => {
  const found = rowsOf(html).find((r) => r.includes(`>${job}<`));
  if (!found) throw new Error(`no row for ${job}`);
  return found;
};

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });

  night('2026-01-01', [
    line('2026-01-01T02:00:00+01:00', 'zeta', 'retry', 'ola'),
    line('2026-01-01T02:01:00+01:00', 'zeta', 'retry', 'ola'),
    line('2026-01-01T02:02:00+01:00', 'zeta', 'retry', 'ola'),
    line('2026-01-01T02:03:00+01:00', 'zeta', 'ok', 'ola'),
    line('2026-01-01T02:04:00+01:00', 'alpha', 'fail', 'kasia', 'disk full'),
    line('2026-01-01T02:05:00+01:00', 'alpha', 'ok', 'kasia'),
    line('2026-01-01T02:06:00+01:00', 'backup', 'ok', null),
    line('2026-01-01T02:07:00+01:00', 'beta', 'ok', 'jan'),
  ]);
  night('2026-01-02', []);
  night('2026-01-03', [
    line('2026-01-03T02:00:00+01:00', 'solo', 'ok', 'jan'),
    'this is not json',
    line('2026-01-03T02:01:00+01:00', 'other', 'ok', 'ola'),
  ]);
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('lists jobs sorted, with — for a null owner', async () => {
    const res = await app.request('/digest/2026-01-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const at = ['alpha', 'backup', 'beta', 'zeta'].map((j) => html.indexOf(`>${j}<`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(rowFor(html, 'backup')).toContain('—');
  });

  it('marks retries >= 3 and any fail, even when the job ends ok', async () => {
    const html = await (await app.request('/digest/2026-01-01')).text();
    for (const job of ['zeta', 'alpha']) {
      expect(rowFor(html, job)).toMatch(/class="[^"]*\bwarn\b/);
    }
    expect(rowFor(html, 'zeta')).toContain('>retries<');
    expect(rowFor(html, 'alpha')).toContain('>fail<');
    expect(rowFor(html, 'beta')).not.toMatch(/\bwarn\b/);
    expect(rowFor(html, 'backup')).not.toMatch(/\bwarn\b/);
  });

  it('says nothing ran for the empty night', async () => {
    const res = await app.request('/digest/2026-01-02');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('keeps good rows and reports a bad line', async () => {
    const res = await app.request('/digest/2026-01-03');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('>solo<');
    expect(html).toContain('>other<');
    expect(html).toContain('1 bad line');
  });

  it('404s for a night with no file and for a bad night string', async () => {
    expect((await app.request('/digest/2026-02-02')).status).toBe(404);
    expect((await app.request('/digest/..%2Fsecret')).status).toBe(404);
    expect((await app.request('/digest/not-a-night')).status).toBe(404);
  });
});

describe('GET /api/digest/:night', () => {
  it('returns night, rows, badLines and counts', async () => {
    const res = await app.request('/api/digest/2026-01-01');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ night: '2026-01-01', badLines: 0, counts: { ok: 4, retry: 3, fail: 1 } });
    expect(Object.keys(body).sort()).toEqual(['badLines', 'counts', 'night', 'rows']);
    expect(body.rows.map((r: { job: string }) => r.job)).toEqual(['alpha', 'backup', 'beta', 'zeta']);
    expect(body.rows.find((r: { job: string }) => r.job === 'backup').owner).toBeNull();
  });

  it('returns empty rows with 200 for the empty night', async () => {
    const res = await app.request('/api/digest/2026-01-02');
    expect(res.status).toBe(200);
    expect((await res.json()).rows).toEqual([]);
  });

  it('keeps good rows and counts a bad line', async () => {
    const res = await app.request('/api/digest/2026-01-03');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r: { job: string }) => r.job)).toEqual(['other', 'solo']);
  });

  it('404s for a night with no file and for a bad night string', async () => {
    expect((await app.request('/api/digest/2026-02-02')).status).toBe(404);
    expect((await app.request('/api/digest/..%2Fsecret')).status).toBe(404);
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order', async () => {
    const html = await (await app.request('/digest/2026-01-01')).text();
    const body = await (await app.request('/api/digest/2026-01-01')).json();
    const jobs: string[] = body.rows.map((r: { job: string }) => r.job);
    const positions = jobs.map((j) => html.indexOf(`>${j}<`));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
