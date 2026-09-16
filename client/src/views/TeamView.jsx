import { useGame } from '../net/game.js';
import { ConnectionDot, InlineForm } from '../components/common.jsx';
import TeamDashboard from '../team/TeamDashboard.jsx';

export default function TeamView() {
  const { connected, state, notice, request } = useGame('team');

  if (state?.role === 'team') {
    return (
      <main className="app app--team">
        {notice && <p className="notice">{notice}</p>}
        <TeamDashboard state={state} request={request} connected={connected} />
      </main>
    );
  }

  return (
    <main className="app app--join">
      <header className="bar">
        <h1>Team Paddock</h1>
        <ConnectionDot connected={connected} />
      </header>
      {notice && <p className="notice">{notice}</p>}
      {!state && <p className="muted">Connecting…</p>}
      {state?.role === 'guest' && <JoinScreen state={state} request={request} />}
    </main>
  );
}

function JoinScreen({ state, request }) {
  const closedReason =
    state.match.status !== 'lobby' ? 'The match has already started, so joining is closed.' : !state.joinable ? 'The match is full.' : null;

  return (
    <>
      <section className="card">
        <h2>Join the competition</h2>
        {closedReason ? (
          <p className="notice">{closedReason}</p>
        ) : (
          <InlineForm
            label="Team name"
            placeholder="e.g. eForce Prague"
            submitLabel="Join"
            maxLength={24}
            autoComplete="off"
            onSubmit={(name) => request('team:join', { name })}
          />
        )}
      </section>
      <section className="card">
        <h2>
          Teams ({state.teams.length}/{state.match.maxTeams})
        </h2>
        {state.teams.length ? (
          <ul className="team-list">
            {state.teams.map((t) => (
              <li key={t.id}>
                <span className="swatch" style={{ background: t.color }} /> {t.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nobody has joined yet.</p>
        )}
      </section>
    </>
  );
}
