import { useGame } from '../net/game.js';
import { ConnectionDot, Feed, InlineForm, PhaseLine, Standings } from '../components/common.jsx';
import { RaceScreen } from '../race/RaceScreen.jsx';

export default function SpectatorView() {
  const { connected, state, request } = useGame('spectator');

  return (
    <main className="app app--screen">
      <header className="bar">
        <h1>eForce Paddock</h1>
        <ConnectionDot connected={connected} />
      </header>
      {!state && <p className="muted">Connecting…</p>}
      {state && state.role !== 'spectator' && (
        <section className="card">
          <InlineForm
            label="Spectator password"
            type="password"
            submitLabel="Open screen"
            autoComplete="current-password"
            onSubmit={(password) => request('spectator:login', { password })}
          />
        </section>
      )}
      {state?.role === 'spectator' && (
        <>
          {state.race && <RaceScreen race={state.race} teams={state.teams} />}
          <section className="card">
            <PhaseLine match={state.match} serverTime={state.serverTime} />
            <ul className="team-list team-list--inline">
              {state.teams.map((t) => (
                <li key={t.id}>
                  <span className="swatch" style={{ background: t.color }} /> {t.name}
                </li>
              ))}
            </ul>
          </section>
          {state.standings && (
            <section className="card">
              <h2>Final standings</h2>
              <Standings standings={state.standings} />
            </section>
          )}
          <section className="card">
            <h2>Paddock feed</h2>
            <Feed feed={state.feed} teams={state.teams} />
          </section>
        </>
      )}
    </main>
  );
}
