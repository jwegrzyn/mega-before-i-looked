import type { DigestRow, Night } from '../digest/types.js';

const DASH = '—';

// Text mark as well as colour: pages are read by agents.
function mark(row: DigestRow): string {
  const marks: string[] = [];
  if (row.retries >= 3) marks.push('retries');
  if (row.fails >= 1) marks.push('fail');
  return marks.join(' ');
}

function badLineNote(n: number): string {
  return `${n} bad ${n === 1 ? 'line' : 'lines'}`;
}

export function NotFound({ night }: { night: string }) {
  return (
    <>
      <h1>digest {night}</h1>
      <p>no run log for this night</p>
    </>
  );
}

export function Digest({ night, data }: { night: string; data: Night }) {
  return (
    <>
      <h1>digest {night}</h1>
      {data.badLines > 0 && <p class="warn">{badLineNote(data.badLines)}</p>}
      {data.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
              <th>mark</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const m = mark(row);
              return (
                <tr class={m === '' ? undefined : 'warn'}>
                  <td>{row.job}</td>
                  <td>{row.owner ?? DASH}</td>
                  <td>{row.runs}</td>
                  <td>{row.retries}</td>
                  <td>{row.lastStatus}</td>
                  <td>{row.lastError ?? DASH}</td>
                  <td>{row.firstAt}</td>
                  <td>{row.lastAt}</td>
                  <td>{m === '' ? DASH : m}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
