// Lines are logfmt: `time=… level=info msg="login" user=aaro`. Loki parses them with `| logfmt`.

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
type Level = keyof typeof LEVELS;
type Fields = Record<string, unknown>;

/** Lines below LOG_LEVEL (default info) are skipped. Quiet during tests. */
const minLevel: Level = (process.env.LOG_LEVEL as Level) in LEVELS ? (process.env.LOG_LEVEL as Level) : 'info';

/** Quotes values with spaces, quotes or `=`; newlines are escaped so each entry stays one line. */
function value(v: unknown): string {
  const s = v instanceof Error ? (v.stack ?? v.message) : typeof v === 'string' ? v : JSON.stringify(v);
  return s === '' || /[\s"=\\]/.test(s) ? JSON.stringify(s) : s;
}

function write(level: Level, msg: string, fields: Fields = {}) {
  if (process.env.VITEST || LEVELS[level] < LEVELS[minLevel]) return;
  const all: Fields = { time: new Date().toISOString(), level, msg, ...fields };
  const line = Object.entries(all)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${value(v)}`)
    .join(' ');
  (level === 'warn' || level === 'error' ? console.error : console.log)(line);
}

export const log = {
  debug: (msg: string, fields?: Fields) => write('debug', msg, fields),
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
};
