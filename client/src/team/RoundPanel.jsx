import { formatMoney, formatSigned, formatSignedMoney } from '../lib/format.js';
import { InboxItem } from './InboxPanel.jsx';

/**
 * Decision phase / lobby: what the current staff and focus will produce this round.
 * Results phase / ended: what the round actually brought, including events.
 */
export function RoundPanel({ me, match, labels }) {
  const showResults = match.phase === 'resolution' || match.status === 'ended';
  const report = me.history.at(-1);

  if (showResults && report) {
    const happened = me.eventLog.filter((e) => e.round === report.round).reverse();
    const newDecisions = me.decisions.length;
    return (
      <section className="card card--results">
        <h2>{match.status === 'ended' ? 'Final round' : `Round ${report.round} results`}</h2>
        <NumbersTable
          rows={[
            ['Performance', formatSigned(report.gains.performance)],
            ['Reliability', formatSigned(report.gains.reliability)],
            ['Income', formatMoney(report.income)],
            ['Running costs', formatSignedMoney(-report.upkeep)],
            ['Net from operations', formatSignedMoney(report.income - report.upkeep)],
          ]}
        />
        <h3 className="subhead">What happened</h3>
        {happened.length ? (
          <ul className="inbox">
            {happened.map((entry, i) => (
              <InboxItem key={i} entry={entry} labels={labels} />
            ))}
          </ul>
        ) : (
          <p className="muted">A quiet round. No events for your team.</p>
        )}
        {newDecisions > 0 && match.status !== 'ended' && (
          <p className="notice">
            {newDecisions === 1 ? 'A new decision is' : `${newDecisions} new decisions are`} waiting for the next round.
          </p>
        )}
      </section>
    );
  }

  const { gains, income, upkeep, net } = me.projection;
  return (
    <section className="card">
      <h2>{match.status === 'lobby' ? 'Forecast per round' : `Round ${match.round} forecast`}</h2>
      <p className="muted small">With your current staff and focus, before any random events.</p>
      <NumbersTable
        rows={[
          ['Performance', formatSigned(gains.performance)],
          ['Reliability', formatSigned(gains.reliability)],
          ['Income', formatMoney(income)],
          ['Running costs', formatSignedMoney(-upkeep)],
          ['Net', formatSignedMoney(net)],
        ]}
      />
    </section>
  );
}

function NumbersTable({ rows }) {
  return (
    <table className="numbers">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td className="num">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
