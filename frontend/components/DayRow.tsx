import type { Entry } from '../../shared/types';
import { formatHM } from '../calc';
import { DurationInput } from './DurationInput';

interface Props {
  date: string;
  entry: Entry | undefined;
  worked: number;
  target: number;
  isToday: boolean;
  onChange: (entry: Entry | undefined) => void;
}

const MODES: { mode: Entry['mode']; label: string }[] = [
  { mode: 'total', label: 'Total' },
  { mode: 'range', label: 'Start–End' },
  { mode: 'off', label: 'Off' },
];

function emptyEntry(mode: Entry['mode']): Entry | undefined {
  switch (mode) {
    case 'total':
      return undefined;
    case 'range':
      return { mode: 'range', start: '', end: '', breakMin: 30 };
    case 'off':
      return { mode: 'off', note: '' };
  }
}

export function DayRow({ date, entry, worked, target, isToday, onChange }: Props) {
  const mode = entry?.mode ?? 'total';
  const dayName = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div className={`day${isToday ? ' today' : ''}${target === 0 && mode !== 'off' ? ' weekend' : ''}`}>
      <div className="day-name">{dayName}</div>

      <div className="mode-toggle" role="group" aria-label={`Input mode for ${date}`}>
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            className={m.mode === mode ? 'active' : ''}
            onClick={() => m.mode !== mode && onChange(emptyEntry(m.mode))}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="day-input">
        {mode === 'total' && (
          <DurationInput
            value={entry?.mode === 'total' ? entry.minutes : null}
            placeholder="e.g. 7:15"
            min={0}
            max={24 * 60}
            ariaLabel={`Hours worked on ${date}`}
            onChange={(minutes) => onChange(minutes === null ? undefined : { mode: 'total', minutes })}
          />
        )}
        {entry?.mode === 'range' && (
          <span className="range">
            <input
              type="time"
              aria-label="Start"
              value={entry.start}
              onChange={(e) => onChange({ ...entry, start: e.target.value })}
            />
            –
            <input
              type="time"
              aria-label="End"
              value={entry.end}
              onChange={(e) => onChange({ ...entry, end: e.target.value })}
            />
            <label>
              break
              <input
                type="number"
                min={0}
                step={5}
                className="break"
                value={entry.breakMin}
                onChange={(e) => onChange({ ...entry, breakMin: Math.max(0, Number(e.target.value) || 0) })}
              />
              min
            </label>
          </span>
        )}
        {entry?.mode === 'off' && (
          <input
            type="text"
            className="note"
            placeholder="Vacation, sick, holiday…"
            value={entry.note ?? ''}
            onChange={(e) => onChange({ mode: 'off', note: e.target.value })}
          />
        )}
      </div>

      <div className="day-figures">
        <span className="num">{formatHM(worked)}</span>
        <span className="muted"> / {formatHM(target)}</span>
      </div>
    </div>
  );
}
