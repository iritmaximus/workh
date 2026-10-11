// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Data } from '../../shared/types';
import { Settings } from '../../frontend/components/Settings';

afterEach(cleanup);

const initial: Data = {
  settings: {
    fullTimeWeekMinutes: 2175,
    workdays: [1, 2, 3, 4, 5],
    trackingStart: '2026-10-05',
    openingBalanceMinutes: 0,
  },
  workloadPeriods: [{ from: '2026-01-01', percent: 100 }],
  entries: {},
};

function Harness({ onData }: { onData: (d: Data) => void }) {
  const [data, setData] = useState(initial);
  return (
    <Settings
      data={data}
      today="2026-10-08"
      onChange={(d) => {
        setData(d);
        onData(d);
      }}
    />
  );
}

describe('Settings', () => {
  it('adds a 50% period and shows its weekly hours', async () => {
    let latest = initial;
    const user = userEvent.setup();
    render(<Harness onData={(d) => (latest = d)} />);
    await user.click(screen.getByText('Settings'));
    await user.click(screen.getByRole('button', { name: '+ Add period' }));

    expect(latest.workloadPeriods).toEqual([
      { from: '2026-01-01', percent: 100 },
      { from: '2026-10-08', percent: 50 },
    ]);
    expect(screen.getByText('= 18:08 h/week')).toBeInTheDocument();
  });

  it('changes a period to 25% and clamps the percentage', async () => {
    let latest = initial;
    const user = userEvent.setup();
    render(<Harness onData={(d) => (latest = d)} />);
    await user.click(screen.getByText('Settings'));
    const pct = screen.getByDisplayValue('100');

    fireEvent.change(pct, { target: { value: '25' } });
    expect(latest.workloadPeriods[0].percent).toBe(25);
    fireEvent.change(pct, { target: { value: '250' } });
    expect(latest.workloadPeriods[0].percent).toBe(100);
  });

  it('accepts a negative opening balance', async () => {
    let latest = initial;
    const user = userEvent.setup();
    render(<Harness onData={(d) => (latest = d)} />);
    await user.click(screen.getByText('Settings'));
    const input = screen.getByPlaceholderText('e.g. -2:30');
    await user.clear(input);
    await user.type(input, '-2:30');
    expect(latest.settings.openingBalanceMinutes).toBe(-150);
  });
});
