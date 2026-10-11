const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
type Level = keyof typeof LEVELS;

/** Lines below LOG_LEVEL (default info) are skipped. Quiet during tests. */
const minLevel: Level = (process.env.LOG_LEVEL as Level) in LEVELS ? (process.env.LOG_LEVEL as Level) : 'info';

function write(level: Level, message: string, err?: unknown) {
  if (process.env.VITEST || LEVELS[level] < LEVELS[minLevel]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}`;
  const out = level === 'warn' || level === 'error' ? console.error : console.log;
  if (err === undefined) out(line);
  else out(line, err);
}

export const log = {
  debug: (message: string) => write('debug', message),
  info: (message: string) => write('info', message),
  warn: (message: string) => write('warn', message),
  error: (message: string, err?: unknown) => write('error', message, err),
};
