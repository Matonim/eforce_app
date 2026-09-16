import { RaceScreen } from '../race/RaceScreen.jsx';

/** Runs the end-of-season competition: start it, then announce it one step at a time. */
export function RacePanel({ state, run }) {
  const { match, race } = state;

  if (!race) {
    if (match.status !== 'ended') return null;
    return (
      <section className="card card--offer">
        <h2>The competition</h2>
        <p>The season is over. Run the event: statics with finals, the dynamic disciplines, endurance lap by lap, then the podium.</p>
        <button className="button" onClick={() => run('gm:startRace')} disabled={!match.teams.length}>
          Start the competition
        </button>
      </section>
    );
  }

  const next = race.steps[race.step + 1];
  return (
    <RaceScreen race={race} teams={match.teams}>
      <div className="actions">
        <button className="button button--ghost" onClick={() => run('gm:raceBack')} disabled={race.step === 0}>
          ← Back
        </button>
        <button className="button" onClick={() => run('gm:raceAdvance')} disabled={race.status === 'finished'}>
          {next ? `Next: ${next.title}` : 'Done'}
        </button>
        <span className="muted small">Only what you have announced is on the teams' screens.</span>
      </div>
    </RaceScreen>
  );
}
