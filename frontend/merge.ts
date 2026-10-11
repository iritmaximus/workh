import type { Data } from '../shared/types';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Three-way merge for when another tab or device saved first.
 * `base` is the version this tab started from, `mine` is this tab's edited copy and
 * `theirs` is what the server has now. Whatever this tab changed wins; everything it
 * did not touch comes from the server. Granularity: one day entry, one setting, or the
 * whole workload-period list.
 */
export function mergeData(base: Data, mine: Data, theirs: Data): Data {
  const pick = <T>(b: T, m: T, t: T): T => (same(m, b) ? t : m);

  const entries: Data['entries'] = {};
  const dates = new Set([...Object.keys(base.entries), ...Object.keys(mine.entries), ...Object.keys(theirs.entries)]);
  for (const date of dates) {
    const entry = pick(base.entries[date], mine.entries[date], theirs.entries[date]);
    if (entry !== undefined) entries[date] = entry;
  }

  const settings = { ...theirs.settings };
  for (const key of Object.keys(mine.settings) as (keyof Data['settings'])[]) {
    (settings as Record<string, unknown>)[key] = pick(base.settings[key], mine.settings[key], theirs.settings[key]);
  }

  return {
    settings,
    workloadPeriods: pick(base.workloadPeriods, mine.workloadPeriods, theirs.workloadPeriods),
    entries,
  };
}
