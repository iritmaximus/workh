import { describe, expect, it } from 'vitest';
import type { Data } from '../../shared/types';
import {
  dayTarget,
  formatDuration,
  formatHM,
  history,
  isoWeekNumber,
  mondayOf,
  parseDuration,
  rangeMinutes,
  weekSummary,
} from '../../frontend/calc';

// 2026-10-05 is a Monday (ISO week 41).
const MON = '2026-10-05';

function data(overrides: Partial<Data> = {}): Data {
  return {
    settings: {
      fullTimeWeekMinutes: 2175,
      workdays: [1, 2, 3, 4, 5],
      trackingStart: MON,
      openingBalanceMinutes: 0,
    },
    workloadPeriods: [{ from: '2026-01-01', percent: 100 }],
    entries: {},
    ...overrides,
  };
}

const fullWeek = (minutes: number) =>
  Object.fromEntries(['05', '06', '07', '08', '09'].map((d) => [`2026-10-${d}`, { mode: 'total' as const, minutes }]));

describe('parseDuration', () => {
  it.each([
    ['7.5', 450],
    ['7,5', 450],
    ['7.15', 435],
    ['7,15', 435],
    ['7.45', 465],
    ['7.05', 425],
    ['7:15', 435],
    ['7h15', 435],
    ['7h 15min', 435],
    ['7h', 420],
    ['45m', 45],
    ['-1:30', -90],
    ['8', 480],
  ])('%s -> %i', (input, expected) => expect(parseDuration(input)).toBe(expected));

  it.each(['', 'abc', '7:75', '7h99', '7.75', '7.123'])('rejects %j', (input) =>
    expect(parseDuration(input)).toBeNull(),
  );
});

describe('formatting', () => {
  it('formats h:mm and long durations', () => {
    expect(formatHM(435)).toBe('7:15');
    expect(formatHM(-90)).toBe('-1:30');
    expect(formatDuration(65, true)).toBe('+1 h 05 min');
    expect(formatDuration(-45, true)).toBe('−0 h 45 min');
    expect(formatDuration(0, true)).toBe('0 h 00 min');
  });
});

describe('dates', () => {
  it('finds the Monday and ISO week', () => {
    expect(mondayOf('2026-10-11')).toBe(MON);
    expect(mondayOf(MON)).toBe(MON);
    expect(isoWeekNumber(MON)).toBe(41);
    expect(isoWeekNumber('2027-01-01')).toBe(53);
  });
});

describe('rangeMinutes', () => {
  it('subtracts the break and handles past-midnight shifts', () => {
    expect(rangeMinutes('08:00', '16:00', 30)).toBe(450);
    expect(rangeMinutes('22:00', '02:00', 0)).toBe(240);
    expect(rangeMinutes('', '16:00', 0)).toBe(0);
  });
});

describe('targets', () => {
  it('is 7:15 per weekday at 100% and 0 at weekends', () => {
    const d = data();
    expect(dayTarget(MON, d)).toBe(435);
    expect(dayTarget('2026-10-10', d)).toBe(0);
    expect(weekSummary(MON, d).target).toBe(2175);
  });

  it('follows 50% and 25% workload periods', () => {
    const d = data({
      workloadPeriods: [
        { from: '2026-01-01', percent: 100 },
        { from: '2026-10-07', percent: 50 },
        { from: '2026-10-09', percent: 25 },
      ],
    });
    expect(dayTarget('2026-10-06', d)).toBe(435);
    expect(dayTarget('2026-10-07', d)).toBe(217.5);
    expect(dayTarget('2026-10-09', d)).toBe(108.75);
    expect(weekSummary(MON, d).target).toBe(435 * 2 + 217.5 * 2 + 108.75);
  });

  it('gives off days a zero target', () => {
    const d = data({ entries: { [MON]: { mode: 'off', note: 'vacation' } } });
    expect(dayTarget(MON, d)).toBe(0);
    expect(weekSummary(MON, d).target).toBe(2175 - 435);
  });
});

describe('weekSummary and history', () => {
  it('is even for a full 7:15 week', () => {
    const d = data({ entries: fullWeek(435) });
    expect(weekSummary(MON, d)).toMatchObject({ worked: 2175, target: 2175, diff: 0 });
  });

  it('accumulates over/under hours across weeks with an opening balance', () => {
    const d = data({
      settings: { ...data().settings, openingBalanceMinutes: 30 },
      entries: {
        ...fullWeek(495), // +60 min/day -> +5 h
        '2026-10-12': { mode: 'total', minutes: 375 }, // -60 min
      },
    });
    const { rows, balance } = history(d, '2026-10-12');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ diff: 300, balance: 330 });
    expect(rows[1]).toMatchObject({ diff: -60, balance: 270 });
    expect(balance).toBe(270);
  });

  it('ignores days after today and before the tracking start', () => {
    const d = data({ settings: { ...data().settings, trackingStart: '2026-10-07' } });
    // Wed + Thu counted, nothing logged -> -2 × 7:15
    expect(history(d, '2026-10-08').balance).toBe(-870);
  });

  it('is empty when tracking starts in the future', () => {
    expect(history(data(), '2026-10-01')).toEqual({ rows: [], balance: 0 });
  });
});
