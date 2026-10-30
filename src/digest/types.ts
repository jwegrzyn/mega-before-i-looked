export type RunStatus = 'ok' | 'retry' | 'fail';

// One job's night. Rows always come sorted by job, so the page and the JSON cannot disagree.
export type DigestRow = {
  job: string;
  // null when the log says null. Keep it null in the data: the `—` is the view's job.
  owner: string | null;
  // Every log line for the job, retries included.
  runs: number;
  // Lines with status `retry`.
  retries: number;
  // Lines with status `fail`. A job can fail and still end ok, so lastStatus can't mark it.
  fails: number;
  lastStatus: RunStatus;
  // The most recent `error` seen for the job, even if its last status is ok. null if none.
  lastError: string | null;
  // `at` of the job's first and last line in file order, offset as written. Never converted to UTC.
  firstAt: string;
  lastAt: string;
};

// Valid lines per status across the whole night. Bad lines are not in here.
export type StatusCounts = Record<RunStatus, number>;

export type Night = {
  found: true;
  // Empty when nothing ran: an empty file, or a file of only bad lines (check badLines).
  rows: DigestRow[];
  // Lines that are not JSON, or are JSON without valid fields. Counted, never thrown.
  badLines: number;
  counts: StatusCounts;
};

// No file for this night, or the night string is not YYYY-MM-DD. Routes answer 404.
export type NoNight = { found: false };

export type NightResult = Night | NoNight;

// Implemented by `readNight` in `src/digest/read-night.ts`. `night` may come straight from a URL:
// anything but YYYY-MM-DD is NoNight, so it cannot read outside runsDir. Never writes.
export type ReadNight = (runsDir: string, night: string) => NightResult;
