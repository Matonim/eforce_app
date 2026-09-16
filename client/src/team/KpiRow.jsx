import { formatMoney, formatNumber, formatSigned, formatSignedMoney } from '../lib/format.js';

/**
 * Headline numbers as stat tiles. The change shown is what happened during the last resolved round
 * (end of that round vs end of the round before, or the starting values).
 */
export function KpiRow({ me }) {
  const last = me.history.at(-1);
  const before = me.history.at(-2) ?? { budget: me.start.budget, stats: me.start.stats, score: me.start.score };
  const delta = (pick) => (last ? pick(last) - pick(before) : null);

  return (
    <div className="kpis">
      <StatTile label="Budget" value={formatMoney(me.budget)} delta={delta((r) => r.budget)} formatDelta={formatSignedMoney} />
      <StatTile label="Performance" value={formatNumber(me.stats.performance)} delta={delta((r) => r.stats.performance)} meter={me.stats.performance} />
      <StatTile label="Reliability" value={formatNumber(me.stats.reliability)} delta={delta((r) => r.stats.reliability)} meter={me.stats.reliability} />
      {me.autonomous && (
        <StatTile label="Autonomy" value={formatNumber(me.stats.autonomy)} delta={delta((r) => r.stats.autonomy)} meter={me.stats.autonomy} />
      )}
      {me.score != null && (
        <StatTile label="Score" value={formatNumber(me.score)} delta={last?.score != null && before.score != null ? last.score - before.score : null} />
      )}
    </div>
  );
}

function StatTile({ label, value, delta, formatDelta = formatSigned, meter }) {
  const rounded = delta == null ? null : Math.round(delta * 10) / 10;
  const direction = rounded == null ? null : rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
  return (
    <div className="tile">
      <span className="tile__label">{label}</span>
      <span className="tile__value">{value}</span>
      {meter != null && (
        <div className="meter" role="meter" aria-label={`${label} out of 100`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter}>
          <div className="meter__fill" style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} />
        </div>
      )}
      {direction && (
        <span className={`delta delta--${direction}`}>
          <span aria-hidden="true">{direction === 'up' ? '▲' : direction === 'down' ? '▼' : '■'}</span> {formatDelta(rounded)}{' '}
          <span className="muted">last round</span>
        </span>
      )}
    </div>
  );
}
