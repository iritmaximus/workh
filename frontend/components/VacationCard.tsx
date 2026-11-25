import { formatDays } from '../calc';

interface Props {
  /** Vacation days from the tracking start up to and including today. */
  used: number;
  /** Vacation days entered for dates after today. */
  planned: number;
}

export function VacationCard({ used, planned }: Props) {
  return (
    <section className="card vacation-card" aria-label="Vacation days">
      <span className="muted">Vacation used</span>
      <div className="vacation-value">{formatDays(used)}</div>
      {planned > 0 && <div className="muted small">+ {formatDays(planned)} planned</div>}
    </section>
  );
}
