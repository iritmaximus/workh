import type { HistoryRow } from '../calc';
import { formatDuration, isoWeekNumber } from '../calc';

interface Props {
  rows: HistoryRow[];
  selected: string;
  onSelect: (monday: string) => void;
}

const tone = (m: number) => (Math.round(m) > 0 ? 'pos' : Math.round(m) < 0 ? 'neg' : '');

export function HistoryTable({ rows, selected, onSelect }: Props) {
  if (rows.length === 0) {
    return (
      <section className="card">
        <h2>History</h2>
        <p className="muted">Nothing tracked yet — the tracking start date is in the future.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>History</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Week</th>
              <th>Starts</th>
              <th className="num">Worked</th>
              <th className="num">Target</th>
              <th className="num">Difference</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr
                key={r.monday}
                className={r.monday === selected ? 'selected' : ''}
                onClick={() => onSelect(r.monday)}
                title="Show this week"
              >
                <td>{isoWeekNumber(r.monday)}</td>
                <td>{r.monday}</td>
                <td className="num">{formatDuration(r.worked)}</td>
                <td className="num">{formatDuration(r.target)}</td>
                <td className={`num ${tone(r.diff)}`}>{formatDuration(r.diff, true)}</td>
                <td className={`num ${tone(r.balance)}`}>{formatDuration(r.balance, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
