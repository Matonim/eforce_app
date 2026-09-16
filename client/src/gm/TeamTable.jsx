import { useState } from 'react';
import { formatMoney, formatNumber } from '../lib/format.js';

const SORTS = {
  score: { label: 'Score', value: (t) => -t.score },
  budget: { label: 'Budget', value: (t) => -t.budget },
  performance: { label: 'Performance', value: (t) => -t.stats.performance },
  reliability: { label: 'Reliability', value: (t) => -t.stats.reliability },
  name: { label: 'Name', value: (t) => t.name.toLowerCase() },
};

/**
 * Live overview of every team. The budget is editable in place — the one thing the GM can fix
 * during a match (everything else should come from the game itself).
 */
export function TeamTable({ state, rules, run, score }) {
  const { match, online } = state;
  const [sort, setSort] = useState('score');
  const [editing, setEditing] = useState(null);

  const teams = [...match.teams]
    .map((t) => ({ ...t, score: score(t) }))
    .sort((a, b) => (SORTS[sort].value(a) > SORTS[sort].value(b) ? 1 : -1));

  return (
    <section className="card">
      <div className="card__head">
        <h2>Teams ({match.teams.length})</h2>
        <label className="muted small">
          Sort by{' '}
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
            {Object.entries(SORTS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!match.teams.length && <p className="muted">No teams yet. Share the team link and let people join.</p>}

      {match.teams.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Team</th>
                <th scope="col" className="num">Budget</th>
                <th scope="col" className="num">Perf</th>
                <th scope="col" className="num">Rel</th>
                <th scope="col" className="num">Score</th>
                <th scope="col">Staff</th>
                <th scope="col" className="num">Focus</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.id}>
                  <td>
                    <span className="swatch" style={{ background: team.color }} />{' '}
                    <span title={`${team.location.name}, ${team.location.country}`}>{team.name}</span>{' '}
                    {team.autonomous && <span title="Driverless programme running">🤖</span>}{' '}
                    <span title={online.teams[team.id] ? `${online.teams[team.id]} device(s) connected` : 'Nobody connected'}>
                      {online.teams[team.id] ? '🟢' : '⚪'}
                    </span>
                  </td>
                  <td className="num">
                    {editing === team.id ? (
                      <BudgetEditor team={team} run={run} done={() => setEditing(null)} />
                    ) : (
                      <button className="cell-button" onClick={() => setEditing(team.id)} disabled={match.status === 'ended'} title="Edit budget">
                        {formatMoney(team.budget)} ✎
                      </button>
                    )}
                  </td>
                  <td className="num">{formatNumber(team.stats.performance)}</td>
                  <td className="num">{formatNumber(team.stats.reliability)}</td>
                  <td className="num">{formatNumber(team.score)}</td>
                  <td className="staff-cells">
                    {rules.departments.map((d) => (
                      <span key={d.id} title={d.label}>
                        {d.label[0]}
                        {team.personnel[d.id]}
                      </span>
                    ))}
                  </td>
                  <td className="num" title="Performance share of the focus slider">
                    {team.focus.performance}%
                  </td>
                  <td className="small">
                    <TeamStatus team={team} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TeamStatus({ team }) {
  const answered = team.pendingDecisions.filter((d) => d.choice).length;
  const waiting = team.pendingDecisions.length - answered;
  return (
    <>
      {waiting > 0 && <span className="badge badge--warn">{waiting} to answer</span>}
      {answered > 0 && <span className="badge badge--good">{answered} answered</span>}
      {team.activeEffects.map((e) => (
        <span key={e.id} className="badge" title={`${e.roundsLeft} round(s) left`}>
          ⟳ {e.label}
        </span>
      ))}
      {team.scheduledEvents.map((s, i) => (
        <span key={i} className="badge badge--muted" title={`Follow-up from ${s.sourceEventId}; the team can't see this`}>
          ↪ {s.eventId} (r{s.round})
        </span>
      ))}
    </>
  );
}

function BudgetEditor({ team, run, done }) {
  const [value, setValue] = useState(String(team.budget));
  return (
    <form
      className="cell-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await run('gm:patchTeam', { teamId: team.id, budget: Number(value) });
        if (result) done();
      }}
    >
      <input className="input input--cell" type="number" step={100} value={value} autoFocus onChange={(e) => setValue(e.target.value)} aria-label={`Budget for ${team.name}`} />
      <button className="button button--small" type="submit">
        Save
      </button>
      <button className="button button--small button--ghost" type="button" onClick={done}>
        Cancel
      </button>
    </form>
  );
}
