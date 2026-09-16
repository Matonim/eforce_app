import { useEffect, useState } from 'react';
import { useAction } from '../lib/useAction.js';
import { formatMoney, formatPercentChange } from '../lib/format.js';

// One extra person adds hundredths of a stat point, so these need two decimals.
const precise = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/**
 * Move people between departments. The team size is fixed, so taking someone out of a department
 * puts them on the bench; the allocation is saved automatically once nobody is left on the bench.
 *
 * Output has diminishing returns, so each row shows what the department produces now and what one
 * more person there would add (both computed by the server in me.projection.departments).
 */
export function StaffPanel({ me, rules, open, request, lobby }) {
  const serverKey = JSON.stringify(me.personnel);
  const [draft, setDraft] = useState(me.personnel);
  const action = useAction(request);

  // A new allocation from the server (saved, or changed by an event) replaces the local draft.
  useEffect(() => setDraft(JSON.parse(serverKey)), [serverKey]);

  const assigned = Object.values(draft).reduce((a, b) => a + b, 0);
  const bench = me.headcount - assigned;
  const draftKey = JSON.stringify(draft);
  const dirty = draftKey !== serverKey;

  useEffect(() => {
    if (open && dirty && bench === 0 && !action.busy) action.run('team:allocate', { personnel: JSON.parse(draftKey) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, open]);

  const change = (dept, by) => {
    action.clearError();
    setDraft((d) => ({ ...d, [dept]: Math.max(0, d[dept] + by) }));
  };

  const modifierFor = (dept) => me.activeEffects.reduce((product, e) => product * (e.modifiers?.[`output.${dept}`] ?? 1), 1);
  const breakdown = me.projection.departments;
  const perMemberCost = breakdown.aero?.nextPerson.cost ?? 0;

  return (
    <section className="card">
      <div className="card__head">
        <h2>Staff</h2>
        <span className="muted small">
          {me.headcount} members · each costs {formatMoney(perMemberCost)} per round
        </span>
      </div>

      <ul className="staff">
        {rules.departments.map((d) => {
          const modifier = modifierFor(d.id);
          const locked = d.id === 'driverless' && !me.autonomous;
          return (
            <li key={d.id} className="staff__row">
              <div className="staff__info">
                <span className="staff__name">
                  {d.label}
                  {modifier !== 1 && <span className="badge badge--warn">output {formatPercentChange(modifier)}</span>}
                </span>
                <span className="muted small">{locked ? 'Start the driverless programme to staff this' : d.description}</span>
                {!locked && <DepartmentOutput id={d.id} output={breakdown[d.id]} />}
              </div>
              <div className="stepper" role="group" aria-label={`${d.label} staff`}>
                <button className="stepper__btn stepper__btn--small" onClick={() => change(d.id, -5)} disabled={!open || draft[d.id] <= 0} aria-label={`Remove five people from ${d.label}`}>
                  −5
                </button>
                <button className="stepper__btn" onClick={() => change(d.id, -1)} disabled={!open || draft[d.id] <= 0} aria-label={`Remove one person from ${d.label}`}>
                  −
                </button>
                <span className="stepper__value" aria-live="polite">
                  {draft[d.id]}
                </span>
                <button className="stepper__btn" onClick={() => change(d.id, 1)} disabled={!open || bench <= 0 || locked} aria-label={`Add one person to ${d.label}`}>
                  +
                </button>
                <button
                  className="stepper__btn stepper__btn--small"
                  onClick={() => change(d.id, Math.min(5, bench))}
                  disabled={!open || bench <= 0 || locked}
                  aria-label={`Add up to five people to ${d.label}`}
                >
                  +5
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className={`status-line ${bench > 0 ? 'status-line--warn' : action.error ? 'status-line--error' : ''}`} role="status">
        {statusText({ bench, error: action.error, busy: action.busy, dirty, open, lobby })}
      </p>
    </section>
  );
}

function statusText({ bench, error, busy, dirty, open, lobby }) {
  if (bench > 0) return `${bench} ${bench === 1 ? 'person' : 'people'} on the bench. Assign everyone to save.`;
  if (error) return `Not saved: ${error}`;
  if (busy) return 'Saving…';
  if (dirty) return open ? 'Saving…' : 'Not saved yet. It saves as soon as changes open again.';
  if (lobby) return 'Saved. Staff work from the first round.';
  return open ? 'Saved. This is what counts when the round is resolved.' : 'Saved.';
}

/** "+0.92 performance · +0.14 reliability per round · next person +0.1 performance · +0.01 reliability" */
function DepartmentOutput({ id, output }) {
  if (!output) return null;
  const parts = (values) =>
    [
      ['performance', 'performance'],
      ['reliability', 'reliability'],
      ['autonomy', 'autonomy'],
    ]
      .filter(([key]) => values[key] > 0)
      .map(([key, label]) => `+${precise.format(values[key])} ${label}`);

  if (id === 'business') {
    return (
      <span className="small">
        Brings {formatMoney(output.sponsorship)} sponsorship per round
        <span className="muted"> · next person +{formatMoney(output.nextPerson.sponsorship)}</span>
      </span>
    );
  }
  const now = parts(output);
  const next = parts(output.nextPerson);
  if (!now.length && !next.length) return <span className="small muted">Nothing this round</span>;
  return (
    <span className="small">
      {now.length ? `${now.join(' · ')} per round` : 'Nothing yet'}
      {next.length > 0 && <span className="muted"> · next person {next.join(' · ')}</span>}
    </span>
  );
}
