import { useMemo } from 'react';
import { ConnectionDot, Feed, PhaseLine } from '../components/common.jsx';
import { makeLabels } from '../lib/format.js';
import { KpiRow } from './KpiRow.jsx';
import { DecisionsPanel } from './DecisionsPanel.jsx';
import { StaffPanel } from './StaffPanel.jsx';
import { FocusPanel } from './FocusPanel.jsx';
import { RoundPanel } from './RoundPanel.jsx';
import { EffectsPanel } from './EffectsPanel.jsx';
import { InboxPanel } from './InboxPanel.jsx';
import { ProgrammePanel } from './ProgrammePanel.jsx';
import { RaceScreen } from '../race/RaceScreen.jsx';
import { SLOT } from '../net/game.js';

/** Why team inputs are closed right now, or null when teams can act. */
function lockReason(match, connected) {
  if (!connected) return 'Reconnecting… your controls come back as soon as the connection does.';
  if (match.status === 'paused') return 'Paused by the Game Master.';
  if (match.status === 'ended') return 'The match has ended.';
  if (match.phase === 'resolution') {
    return match.round >= match.totalRounds ? 'Final results are in.' : 'Round results. Changes open again when the next round starts.';
  }
  return null;
}

export default function TeamDashboard({ state, request, connected }) {
  const { me, match, rules } = state;
  const labels = useMemo(() => makeLabels(rules), [rules]);
  const locked = lockReason(match, connected);
  const open = locked === null;
  // During results (and after the match) the round summary is the main thing to look at.
  const resultsFirst = match.phase === 'resolution' || match.status === 'ended';
  const roundPanel = <RoundPanel me={me} match={match} labels={labels} />;

  return (
    <div className="dash">
      <header className="dash__header">
        <div className="dash__identity">
          <span className="swatch swatch--lg" style={{ background: me.color }} />
          <div>
            <h1>{me.name}</h1>
            <p className="muted">
              {me.location.name}, {me.location.country}
              {me.location.costLevel != null && (
                <span title="Compared with an average location">
                  {' '}
                  · costs ×{me.location.costLevel} · sponsors ×{me.location.sponsorLevel}
                </span>
              )}
              {SLOT && <span> · slot {SLOT}</span>}
            </p>
          </div>
        </div>
        <div className="dash__phase">
          <PhaseLine match={match} serverTime={state.serverTime} />
        </div>
        <ConnectionDot connected={connected} />
      </header>

      <KpiRow me={me} />

      {locked && <p className="lock-banner">{locked}</p>}

      {state.race && <RaceScreen race={state.race} teams={state.teams} myTeamId={me.id} />}

      {state.standings && <StandingsCard standings={state.standings} myId={me.id} />}

      <div className="dash__grid">
        <div className="dash__col">
          {resultsFirst && roundPanel}
          <DecisionsPanel me={me} match={match} labels={labels} open={open} request={request} />
          <StaffPanel me={me} rules={rules} labels={labels} open={open} request={request} lobby={match.status === 'lobby'} />
          <FocusPanel me={me} rules={rules} open={open} request={request} />
          <ProgrammePanel me={me} rules={rules} open={open} request={request} />
        </div>
        <div className="dash__col">
          {!resultsFirst && roundPanel}
          <EffectsPanel me={me} labels={labels} />
          <InboxPanel me={me} labels={labels} />
          <section className="card">
            <h2>Paddock feed</h2>
            <p className="muted small">Public posts from all teams.</p>
            <Feed feed={state.feed} teams={state.teams} />
          </section>
        </div>
      </div>

      {match.status === 'lobby' && (
        <p className="dash__footer">
          <button className="link" onClick={() => confirm('Leave this team? Your spot will be free for someone else.') && request('team:leave').catch((err) => alert(err.message))}>
            Leave team
          </button>
        </p>
      )}
    </div>
  );
}

function StandingsCard({ standings, myId }) {
  return (
    <section className="card">
      <h2>Final standings</h2>
      <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Place</th>
            <th scope="col">Team</th>
            <th scope="col" className="num">{standings[0]?.source === 'race' ? 'Points' : 'Score'}</th>
            <th scope="col" className="num">Performance</th>
            <th scope="col" className="num">Reliability</th>
            <th scope="col" className="num">Budget</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row) => (
            <tr key={row.teamId} className={row.teamId === myId ? 'table__me' : undefined}>
              <td>{row.place}</td>
              <td>
                <span className="swatch" style={{ background: row.color }} /> {row.name}
                {row.teamId === myId && <span className="muted"> (you)</span>}
              </td>
              <td className="num">{row.score}</td>
              <td className="num">{row.performance}</td>
              <td className="num">{row.reliability}</td>
              <td className="num">€{row.budget.toLocaleString('en-US')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}
