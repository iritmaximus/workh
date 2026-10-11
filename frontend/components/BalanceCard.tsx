import { formatDuration } from '../calc';

interface Props {
  balance: number;
  trackingStart: string;
  today: string;
}

export function BalanceCard({ balance, trackingStart, today }: Props) {
  const r = Math.round(balance);
  const tone = r > 0 ? 'pos' : r < 0 ? 'neg' : '';
  const label = r > 0 ? 'extra hours banked' : r < 0 ? 'hours short' : 'exactly even';

  return (
    <section className={`card balance ${tone}`}>
      <span className="muted">Balance</span>
      <div className="balance-value">{formatDuration(balance, true)}</div>
      <div>{label}</div>
      <div className="muted small">
        {trackingStart} → {today}, including the opening balance
      </div>
    </section>
  );
}
