import { useMemo, useState } from 'react';

/** Fire any event by hand, and check first why it wouldn't fire on its own. */
export function TriggerPanel({ state, run }) {
  const { match, events } = state;
  const [search, setSearch] = useState('');
  const [eventId, setEventId] = useState(null);
  const [teamIds, setTeamIds] = useState([]);
  const [respectConditions, setRespectConditions] = useState(false);
  const [explained, setExplained] = useState(null);
  const [result, setResult] = useState(null);

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return events.definitions;
    return events.definitions.filter((d) =>
      [d.id, d.title, d.scope, ...(d.tags ?? [])].join(' ').toLowerCase().includes(needle),
    );
  }, [events.definitions, search]);

  const selected = events.definitions.find((d) => d.id === eventId) ?? null;
  const toggleTeam = (id) => setTeamIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const select = (id) => {
    setEventId(id);
    setExplained(null);
    setResult(null);
  };

  async function explain() {
    const response = await run('gm:explain', { eventId });
    if (response) setExplained(response.teams);
  }

  async function fire() {
    const response = await run('gm:trigger', {
      eventId,
      teamIds: teamIds.length ? teamIds : undefined,
      respectConditions,
    });
    if (response) {
      setResult(`Fired for ${response.results.length} team(s).`);
      setExplained(null);
    }
  }

  const needsTeams = selected && selected.scope === 'team' && teamIds.length === 0;

  return (
    <section className="card">
      <div className="card__head">
        <h2>Trigger an event</h2>
        <span className="muted small">Ignores weight, conditions and limits unless you ask for them.</span>
      </div>

      <input
        className="input"
        type="search"
        value={search}
        placeholder="Search events by name, id or tag"
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search events"
      />

      <ul className="event-list">
        {matches.map((def) => (
          <li key={def.id}>
            <button className={`event-item ${def.id === eventId ? 'event-item--selected' : ''}`} onClick={() => select(def.id)}>
              <span className="event-item__title">
                {def.title}
                {def.scope === 'global' && <span className="badge badge--muted">global</span>}
                {def.hasDecision && <span className="badge badge--muted">decision</span>}
                {!def.enabled && <span className="badge badge--warn">disabled</span>}
              </span>
              <span className="muted small">
                {def.id} · weight {def.weight}
                {def.tags?.length ? ` · ${def.tags.join(', ')}` : ''}
              </span>
            </button>
          </li>
        ))}
        {!matches.length && <li className="muted">No events match "{search}".</li>}
      </ul>

      {selected && (
        <>
          <h3 className="subhead">Teams</h3>
          {match.teams.length === 0 && <p className="muted">No teams yet.</p>}
          <div className="checks">
            {match.teams.map((team) => (
              <label key={team.id} className="check">
                <input type="checkbox" checked={teamIds.includes(team.id)} onChange={() => toggleTeam(team.id)} />
                <span className="swatch" style={{ background: team.color }} /> {team.name}
              </label>
            ))}
          </div>
          <div className="actions">
            <button className="link" onClick={() => setTeamIds(match.teams.map((t) => t.id))}>
              Select all
            </button>
            <button className="link" onClick={() => setTeamIds([])}>
              Clear
            </button>
          </div>

          <label className="check">
            <input type="checkbox" checked={respectConditions} onChange={(e) => setRespectConditions(e.target.checked)} />
            Only teams that match the event's conditions
          </label>

          <div className="actions">
            <button className="button" onClick={fire} disabled={needsTeams}>
              Fire "{selected.title}"
            </button>
            <button className="button button--ghost" onClick={explain}>
              Why wouldn't it fire?
            </button>
          </div>
          {needsTeams && <p className="muted small">Pick at least one team (global events default to all teams).</p>}
          {result && <p className="status-line">{result}</p>}

          {explained && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Team</th>
                    <th scope="col">Would fire on its own?</th>
                  </tr>
                </thead>
                <tbody>
                  {explained.map((row) => {
                    const team = match.teams.find((t) => t.id === row.teamId);
                    return (
                      <tr key={row.teamId}>
                        <td>
                          <span className="swatch" style={{ background: team?.color }} /> {team?.name ?? row.teamId}
                        </td>
                        <td className={row.eligible ? 'good' : 'muted'}>{row.eligible ? 'Yes' : row.reasons.join('; ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
