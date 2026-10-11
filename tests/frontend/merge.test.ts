import { describe, expect, it } from 'vitest';
import type { Data } from '../../shared/types';
import { mergeData } from '../../frontend/merge';

const base: Data = {
  settings: {
    fullTimeWeekMinutes: 2175,
    workdays: [1, 2, 3, 4, 5],
    trackingStart: '2026-10-05',
    openingBalanceMinutes: 0,
  },
  workloadPeriods: [{ from: '2026-01-01', percent: 100 }],
  entries: { '2026-10-05': { mode: 'total', minutes: 435 } },
};

describe('mergeData', () => {
  it('keeps changes to different days from both sides', () => {
    const mine = { ...base, entries: { ...base.entries, '2026-10-06': { mode: 'total' as const, minutes: 420 } } };
    const theirs = { ...base, entries: { ...base.entries, '2026-10-05': { mode: 'total' as const, minutes: 480 } } };
    expect(mergeData(base, mine, theirs).entries).toEqual({
      '2026-10-05': { mode: 'total', minutes: 480 },
      '2026-10-06': { mode: 'total', minutes: 420 },
    });
  });

  it('lets my edit win when both sides changed the same day', () => {
    const mine = { ...base, entries: { '2026-10-05': { mode: 'total' as const, minutes: 100 } } };
    const theirs = { ...base, entries: { '2026-10-05': { mode: 'total' as const, minutes: 200 } } };
    expect(mergeData(base, mine, theirs).entries['2026-10-05']).toEqual({ mode: 'total', minutes: 100 });
  });

  it('keeps deletions from either side', () => {
    const mine = { ...base, entries: {} };
    expect(mergeData(base, mine, base).entries).toEqual({});
    expect(mergeData(base, base, mine).entries).toEqual({});
  });

  it('merges settings field by field and periods as a whole', () => {
    const mine = { ...base, settings: { ...base.settings, openingBalanceMinutes: -60 } };
    const theirs = {
      ...base,
      settings: { ...base.settings, trackingStart: '2026-09-28' },
      workloadPeriods: [...base.workloadPeriods, { from: '2026-11-01', percent: 50 }],
    };
    const merged = mergeData(base, mine, theirs);
    expect(merged.settings).toMatchObject({ openingBalanceMinutes: -60, trackingStart: '2026-09-28' });
    expect(merged.workloadPeriods).toHaveLength(2);
  });
});
