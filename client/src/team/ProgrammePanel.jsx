import { useAction } from '../lib/useAction.js';
import { formatMoney, formatNumber } from '../lib/format.js';

/**
 * The driverless programme: opt in to score in the DV disciplines, at the price of a setup fee,
 * a running cost and people who could have been building the car instead.
 */
export function ProgrammePanel({ me, rules, open, request }) {
  const action = useAction(request);
  const { setupCost, incomeMultiplier } = rules.autonomous;
  // Includes the location's cost level and the season length, so it matches the forecast.
  const perRoundCost = me.projection.programmeCost;
  const staffed = me.personnel.driverless > 0;

  return (
    <section className={`card ${me.autonomous ? '' : 'card--offer'}`}>
      <div className="card__head">
        <h2>Driverless programme</h2>
        <span className={me.autonomous ? 'badge badge--good' : 'muted small'}>{me.autonomous ? 'Running' : 'Not started'}</span>
      </div>

      {me.autonomous ? (
        <>
          <p>
            Autonomy <strong>{formatNumber(me.stats.autonomy)}</strong>/100. It grows every round from your driverless staff
            (and a little from electronics).
          </p>
          <p className="muted small">
            Costs {formatMoney(perRoundCost)} per round · sponsors pay {Math.round((incomeMultiplier - 1) * 100)}% more ·
            unlocks Acceleration DV (75) and Skidpad DV (75) at the competition.
          </p>
          <button
            className="button button--ghost"
            disabled={!open || action.busy || staffed}
            onClick={() => action.run('team:setAutonomous', { enabled: false })}
            title={staffed ? 'Move your driverless staff elsewhere first' : undefined}
          >
            Stop the programme
          </button>
          {staffed && <p className="muted small">Move your driverless staff to other departments before stopping.</p>}
        </>
      ) : (
        <>
          <p>
            Two driverless disciplines are worth <strong>150 points</strong> at the competition. Without an autonomous car you
            score nothing in them.
          </p>
          <ul className="bullets small">
            <li>{formatMoney(setupCost)} to start, then {formatMoney(perRoundCost)} every round</li>
            <li>Needs people in Driverless &amp; Software — they don't make the car faster</li>
            <li>Sponsors pay {Math.round((incomeMultiplier - 1) * 100)}% more: the industry is watching</li>
          </ul>
          <button className="button" disabled={!open || action.busy || me.budget < setupCost} onClick={() => action.run('team:setAutonomous', { enabled: true })}>
            Start the programme ({formatMoney(setupCost)})
          </button>
          {me.budget < setupCost && <p className="muted small">Not enough budget yet.</p>}
        </>
      )}
      {action.error && <p className="status-line status-line--error">{action.error}</p>}
    </section>
  );
}
