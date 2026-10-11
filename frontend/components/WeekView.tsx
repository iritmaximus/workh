import type { Data, Entry } from '../../shared/types';
import { addDays, formatDuration, isoWeekNumber, mondayOf, weekSummary } from '../calc';
import { DayRow } from './DayRow';

interface Props {
  data: Data;
  monday: string;
  today: string;
  onNavigate: (monday: string) => void;
  onEntryChange: (date: string, entry: Entry | undefined) => void;
}

const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });

export function WeekView({ data, monday, today, onNavigate, onEntryChange }: Props) {
  const week = weekSummary(monday, data);
  const sunday = addDays(monday, 6);
  const isCurrent = monday === mondayOf(today);

  return (
    <section className="card week">
      <header className="week-nav">
        <button type="button" onClick={() => onNavigate(addDays(monday, -7))} aria-label="Previous week">
          ◀
        </button>
        <h2>
          Week {isoWeekNumber(monday)}
          <span className="muted">
            {' '}
            {fmtDate(monday, { day: 'numeric', month: 'short' })} –{' '}
            {fmtDate(sunday, { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </h2>
        <button type="button" onClick={() => onNavigate(addDays(monday, 7))} aria-label="Next week">
          ▶
        </button>
        {!isCurrent && (
          <button type="button" className="link" onClick={() => onNavigate(mondayOf(today))}>
            This week
          </button>
        )}
      </header>

      <div className="days">
        {week.days.map((d) => (
          <DayRow
            key={d.date}
            date={d.date}
            entry={data.entries[d.date]}
            worked={d.worked}
            target={d.target}
            isToday={d.date === today}
            onChange={(entry) => onEntryChange(d.date, entry)}
          />
        ))}
      </div>

      <footer className="week-total">
        <div>
          <span className="muted">Worked</span>
          <strong>{formatDuration(week.worked)}</strong>
        </div>
        <div>
          <span className="muted">Target</span>
          <strong>{formatDuration(week.target)}</strong>
        </div>
        <div className={Math.round(week.diff) > 0 ? 'pos' : Math.round(week.diff) < 0 ? 'neg' : ''}>
          <span className="muted">This week</span>
          <strong>
            {formatDuration(week.diff, true)}
            {Math.round(week.diff) > 0 ? ' over' : Math.round(week.diff) < 0 ? ' under' : ' — on target'}
          </strong>
        </div>
      </footer>
    </section>
  );
}
