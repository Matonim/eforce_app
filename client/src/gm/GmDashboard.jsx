import { useState } from 'react';
import { ConnectionDot, Standings } from '../components/common.jsx';
import { ControlBar } from './ControlBar.jsx';
import { TeamTable } from './TeamTable.jsx';
import { TriggerPanel } from './TriggerPanel.jsx';
import { PostPanel } from './PostPanel.jsx';
import { EventsStatus } from './EventsStatus.jsx';
import { RacePanel } from './RacePanel.jsx';

export default function GmDashboard({ state, request, connected }) {
  const [error, setError] = useState(null);
  const { online } = state;

  /** Every GM action goes through here: clears the last error, shows a new one, returns null on failure. */
  const run = async (event, payload) => {
    setError(null);
    try {
      return await request(event, payload);
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  return (
    <div className="dash">
      <header className="dash__header">
        <div className="dash__identity">
          <h1>Game Master</h1>
        </div>
        <p className="muted">
          {Object.values(online.teams).filter(Boolean).length}/{state.match.teams.length} teams connected · {online.spectators}{' '}
          screen(s) · {online.guests} waiting
        </p>
        <button className="link" onClick={() => run('session:logout')}>
          Sign out
        </button>
        <ConnectionDot connected={connected} />
      </header>

      <ControlBar state={state} run={run} busyError={error} />

      <RacePanel state={state} run={run} />

      {state.standings && (
        <section className="card">
          <h2>Final standings</h2>
          <Standings standings={state.standings} />
        </section>
      )}

      <TeamTable state={state} rules={state.rules} run={run} score={(team) => state.scores[team.id]} />

      <div className="dash__grid">
        <div className="dash__col">
          <TriggerPanel state={state} run={run} />
          <EventsStatus state={state} run={run} />
        </div>
        <div className="dash__col">
          <PostPanel state={state} run={run} />
        </div>
      </div>
    </div>
  );
}
