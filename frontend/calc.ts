import type { Data, Entry, WorkloadPeriod } from '../shared/types';

// ---------- Dates (ISO strings, computed in UTC so DST never shifts a day) ----------

const DAY_MS = 86_400_000;

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toISO = (d: Date) => d.toISOString().slice(0, 10);

export function todayISO(now = new Date()): string {
  return toISO(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function addDays(iso: string, n: number): string {
  return toISO(new Date(toDate(iso).getTime() + n * DAY_MS));
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(iso: string): number {
  return toDate(iso).getUTCDay() || 7;
}

export function mondayOf(iso: string): string {
  return addDays(iso, 1 - isoWeekday(iso));
}

export function isoWeekNumber(iso: string): number {
  const thursday = toDate(addDays(iso, 4 - isoWeekday(iso)));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - yearStart) / DAY_MS / 7) + 1;
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

// ---------- Durations ----------

/**
 * Parses "7.5", "7,5", "7:30", "7h30", "7h 30min", "45m" or "-1:30" into minutes.
 * Returns null for anything it does not understand; "" also returns null.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (s === '') return null;
  const sign = s.startsWith('-') ? -1 : 1;
  const body = s.replace(/^[+-]/, '');

  let m: RegExpMatchArray | null;
  if ((m = body.match(/^(\d+)(?:[.,](\d+))?h?$/))) {
    return sign * Math.round(parseFloat(`${m[1]}.${m[2] ?? '0'}`) * 60);
  }
  if ((m = body.match(/^(\d+):(\d{1,2})$/)) && Number(m[2]) < 60) {
    return sign * (Number(m[1]) * 60 + Number(m[2]));
  }
  if ((m = body.match(/^(\d+)h(\d{1,2})(?:m|min)?$/)) && Number(m[2]) < 60) {
    return sign * (Number(m[1]) * 60 + Number(m[2]));
  }
  if ((m = body.match(/^(\d+)(?:m|min)$/))) {
    return sign * Number(m[1]);
  }
  return null;
}

/** 435 -> "7:15", -90 -> "-1:30". Rounds to whole minutes. */
export function formatHM(minutes: number): string {
  const r = Math.round(minutes);
  const abs = Math.abs(r);
  return `${r < 0 ? '-' : ''}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

/** 65 -> "1 h 05 min"; with signed: "+1 h 05 min" / "−1 h 05 min". */
export function formatDuration(minutes: number, signed = false): string {
  const r = Math.round(minutes);
  const abs = Math.abs(r);
  const text = `${Math.floor(abs / 60)} h ${String(abs % 60).padStart(2, '0')} min`;
  if (!signed || r === 0) return r < 0 ? `−${text}` : text;
  return `${r > 0 ? '+' : '−'}${text}`;
}

const clockMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Worked minutes for a start/end range; an end before the start means past midnight. */
export function rangeMinutes(start: string, end: string, breakMin: number): number {
  if (!start || !end) return 0;
  let span = clockMinutes(end) - clockMinutes(start);
  if (span < 0) span += 24 * 60;
  return Math.max(0, span - breakMin);
}

// ---------- Targets and balances ----------

export function dayWorked(entry: Entry | undefined): number {
  if (!entry) return 0;
  switch (entry.mode) {
    case 'total':
      return entry.minutes;
    case 'range':
      return rangeMinutes(entry.start, entry.end, entry.breakMin);
    case 'off':
      return 0;
  }
}

/** Workload % in force on `date`: the latest period starting on or before it (100% if none). */
export function percentOn(date: string, periods: WorkloadPeriod[]): number {
  let best: WorkloadPeriod | undefined;
  for (const p of periods) {
    if (p.from <= date && (!best || p.from > best.from)) best = p;
  }
  return best ? best.percent : 100;
}

export function dayTarget(date: string, data: Data): number {
  const { workdays, fullTimeWeekMinutes } = data.settings;
  if (!workdays.includes(isoWeekday(date))) return 0;
  if (data.entries[date]?.mode === 'off') return 0;
  return (fullTimeWeekMinutes / workdays.length) * (percentOn(date, data.workloadPeriods) / 100);
}

export interface DaySummary {
  date: string;
  worked: number;
  target: number;
}

export interface WeekSummary {
  monday: string;
  days: DaySummary[];
  worked: number;
  target: number;
  diff: number;
}

function summarize(monday: string, days: DaySummary[]): WeekSummary {
  const worked = days.reduce((a, d) => a + d.worked, 0);
  const target = days.reduce((a, d) => a + d.target, 0);
  return { monday, days, worked, target, diff: worked - target };
}

/** Full Monday–Sunday summary, regardless of tracking start or today. */
export function weekSummary(monday: string, data: Data): WeekSummary {
  return summarize(
    monday,
    weekDays(monday).map((date) => ({
      date,
      worked: dayWorked(data.entries[date]),
      target: dayTarget(date, data),
    })),
  );
}

export interface HistoryRow extends WeekSummary {
  /** Running balance at the end of this week (includes the opening balance). */
  balance: number;
}

/**
 * Week-by-week totals from the tracking start up to and including `today`.
 * Days after today are left out, so an unfinished week never shows as missing hours.
 */
export function history(data: Data, today: string): { rows: HistoryRow[]; balance: number } {
  const start = data.settings.trackingStart;
  let balance = data.settings.openingBalanceMinutes;
  const rows: HistoryRow[] = [];
  if (start > today) return { rows, balance };

  for (let monday = mondayOf(start); monday <= today; monday = addDays(monday, 7)) {
    const days = weekDays(monday)
      .filter((date) => date >= start && date <= today)
      .map((date) => ({ date, worked: dayWorked(data.entries[date]), target: dayTarget(date, data) }));
    const week = summarize(monday, days);
    balance += week.diff;
    rows.push({ ...week, balance });
  }
  return { rows, balance };
}
