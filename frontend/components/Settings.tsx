import type { Data, Settings as SettingsT, WorkloadPeriod } from '../../shared/types';
import { formatHM } from '../calc';
import { DurationInput } from './DurationInput';

interface Props {
  data: Data;
  today: string;
  onChange: (data: Data) => void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function Settings({ data, today, onChange }: Props) {
  const s = data.settings;
  const setSettings = (patch: Partial<SettingsT>) => onChange({ ...data, settings: { ...s, ...patch } });
  const setPeriods = (workloadPeriods: WorkloadPeriod[]) => onChange({ ...data, workloadPeriods });

  const toggleWorkday = (day: number) => {
    const workdays = s.workdays.includes(day) ? s.workdays.filter((d) => d !== day) : [...s.workdays, day].sort();
    if (workdays.length > 0) setSettings({ workdays });
  };

  return (
    <details className="card settings">
      <summary>
        <h2>Settings</h2>
        <span className="muted">
          {formatHM(s.fullTimeWeekMinutes)} h/week at 100% · tracking since {s.trackingStart}
        </span>
      </summary>

      <div className="settings-grid">
        <label>
          Full-time week (100%)
          <DurationInput
            value={s.fullTimeWeekMinutes}
            onChange={(m) => m !== null && m > 0 && setSettings({ fullTimeWeekMinutes: m })}
          />
        </label>

        <label>
          Tracking start
          <input
            type="date"
            value={s.trackingStart}
            onChange={(e) => e.target.value && setSettings({ trackingStart: e.target.value })}
          />
        </label>

        <label>
          Opening balance
          <DurationInput
            value={s.openingBalanceMinutes}
            placeholder="e.g. -2:30"
            onChange={(m) => setSettings({ openingBalanceMinutes: m ?? 0 })}
          />
        </label>

        <fieldset>
          <legend>Working days</legend>
          {WEEKDAYS.map((name, i) => (
            <label key={name} className="check">
              <input type="checkbox" checked={s.workdays.includes(i + 1)} onChange={() => toggleWorkday(i + 1)} />
              {name}
            </label>
          ))}
        </fieldset>
      </div>

      <h3>Workload periods</h3>
      <p className="muted small">
        Each period applies from its date until the next one starts. Daily target = full-time week ÷ working days ×
        percentage.
      </p>
      <ul className="periods">
        {data.workloadPeriods
          .map((p, i) => ({ p, i }))
          .sort((a, b) => a.p.from.localeCompare(b.p.from))
          .map(({ p, i }) => (
            <li key={i}>
              from
              <input
                type="date"
                value={p.from}
                onChange={(e) =>
                  e.target.value &&
                  setPeriods(data.workloadPeriods.map((q, j) => (j === i ? { ...q, from: e.target.value } : q)))
                }
              />
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={p.percent}
                onChange={(e) =>
                  setPeriods(
                    data.workloadPeriods.map((q, j) =>
                      j === i ? { ...q, percent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) } : q,
                    ),
                  )
                }
              />
              %<span className="muted">= {formatHM((s.fullTimeWeekMinutes * p.percent) / 100)} h/week</span>
              <button
                type="button"
                className="link danger"
                onClick={() => setPeriods(data.workloadPeriods.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </li>
          ))}
      </ul>
      <button type="button" onClick={() => setPeriods([...data.workloadPeriods, { from: today, percent: 50 }])}>
        + Add period
      </button>
    </details>
  );
}
