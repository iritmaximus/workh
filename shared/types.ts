// Shared between the Express server and the React client.
// All durations are whole minutes; all dates are ISO "YYYY-MM-DD" strings.

export interface Settings {
  /** Full-time (100%) weekly target in minutes, e.g. 36 h 15 min = 2175. */
  fullTimeWeekMinutes: number;
  /** ISO weekdays that are working days (1 = Monday ... 7 = Sunday). */
  workdays: number[];
  /** First day counted towards the running balance. */
  trackingStart: string;
  /** Balance carried over from before trackingStart (may be negative). */
  openingBalanceMinutes: number;
}

/** Workload percentage that applies from `from` until the next period starts. */
export interface WorkloadPeriod {
  from: string;
  percent: number;
}

export type Entry =
  | { mode: 'total'; minutes: number }
  | { mode: 'range'; start: string; end: string; breakMin: number }
  | { mode: 'off'; note?: string };

export interface Data {
  settings: Settings;
  workloadPeriods: WorkloadPeriod[];
  entries: Record<string, Entry>;
}

export function defaultData(today = new Date()): Data {
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  const monday = d.toISOString().slice(0, 10);
  return {
    settings: {
      fullTimeWeekMinutes: 36 * 60 + 15,
      workdays: [1, 2, 3, 4, 5],
      trackingStart: monday,
      openingBalanceMinutes: 0,
    },
    workloadPeriods: [{ from: monday, percent: 100 }],
    entries: {},
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^(\d{2}:\d{2})?$/;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function isEntry(v: unknown): v is Entry {
  if (!isObj(v)) return false;
  switch (v.mode) {
    case 'total':
      return isNum(v.minutes);
    case 'range':
      return (
        typeof v.start === 'string' &&
        HHMM.test(v.start) &&
        typeof v.end === 'string' &&
        HHMM.test(v.end) &&
        isNum(v.breakMin)
      );
    case 'off':
      return v.note === undefined || typeof v.note === 'string';
    default:
      return false;
  }
}

/** Runtime check used by the server before writing data.json. */
export function isData(v: unknown): v is Data {
  if (!isObj(v) || !isObj(v.settings) || !Array.isArray(v.workloadPeriods) || !isObj(v.entries)) {
    return false;
  }
  const s = v.settings;
  if (
    !isNum(s.fullTimeWeekMinutes) ||
    !Array.isArray(s.workdays) ||
    !s.workdays.every((d) => isNum(d) && d >= 1 && d <= 7) ||
    typeof s.trackingStart !== 'string' ||
    !ISO_DATE.test(s.trackingStart) ||
    !isNum(s.openingBalanceMinutes)
  ) {
    return false;
  }
  const periodsOk = v.workloadPeriods.every(
    (p) => isObj(p) && typeof p.from === 'string' && ISO_DATE.test(p.from) && isNum(p.percent),
  );
  const entriesOk = Object.entries(v.entries).every(([k, e]) => ISO_DATE.test(k) && isEntry(e));
  return periodsOk && entriesOk;
}
