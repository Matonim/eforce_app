import { useEffect, useState } from 'react';
import { PhaseLine } from '../components/common.jsx';

const SETTINGS = [
  { key: 'totalRounds', label: 'Rounds', min: 1, max: 30 },
  { key: 'decisionSeconds', label: 'Decision phase (s)', min: 10, max: 600 },
  { key: 'resolutionSeconds', label: 'Results phase (s)', min: 3, max: 120 },
];

/** Everything the GM needs while running the room: phase, timer and the match controls. */
export function ControlBar({ state, run, busyError }) {
  const { match, loop } = state;
  const inMatch = match.status === 'running' || match.status === 'paused';
  const lastRound = match.phase === 'resolution' && match.round >= match.config.totalRounds;
  // The GM gets the raw match object, where the round count lives in config.
  const phaseMatch = { ...match, totalRounds: match.config.totalRounds };

  return (
    <section className="card control">
      <PhaseLine match={phaseMatch} serverTime={state.serverTime} />

      <div className="actions">
        <button className="button" onClick={() => run('gm:start')} disabled={match.status !== 'lobby' || match.teams.length === 0}>
          Start match
        </button>
        <button className="button" onClick={() => run('gm:advance')} disabled={!inMatch}>
          {lastRound ? 'Finish match' : 'Next phase'}
        </button>
        {match.status === 'paused' ? (
          <button className="button" onClick={() => run('gm:resume')}>
            Resume
          </button>
        ) : (
          <button className="button" onClick={() => run('gm:pause')} disabled={match.status !== 'running'}>
            Pause
          </button>
        )}
        <button className="button button--ghost" onClick={() => run('gm:addTime', { seconds: 30 })} disabled={!inMatch}>
          +30s
        </button>
        <button className="button button--ghost" onClick={() => run('gm:addTime', { seconds: -15 })} disabled={!inMatch}>
          −15s
        </button>
        <span className="actions__spacer" />
        <button className="button button--ghost" onClick={() => confirm('End the match now and show final standings?') && run('gm:end')} disabled={!inMatch}>
          End
        </button>
        <button
          className="button button--ghost"
          onClick={() => confirm('Reset to the lobby? Teams keep their places, the match starts over.') && run('gm:reset', { keepTeams: true })}
        >
          Reset
        </button>
      </div>

      {busyError && <p className="error">{busyError}</p>}
      {loop.lastError && <p className="error">Phase error (the match was paused): {loop.lastError}</p>}

      {match.status === 'lobby' ? <Settings config={match.config} run={run} /> : <CurrentSettings config={match.config} />}
    </section>
  );
}

function CurrentSettings({ config }) {
  return (
    <p className="muted small">
      {config.totalRounds} rounds · {config.decisionSeconds}s decisions · {config.resolutionSeconds}s results · seed "{config.seed}"
    </p>
  );
}

function Settings({ config, run }) {
  const saved = Object.fromEntries(SETTINGS.map((s) => [s.key, config[s.key]]));
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(JSON.parse(savedKey)), [savedKey]);

  const changed = SETTINGS.some((s) => Number(draft[s.key]) !== saved[s.key]);
  return (
    <form
      className="settings"
      onSubmit={(e) => {
        e.preventDefault();
        run('gm:configure', Object.fromEntries(SETTINGS.map((s) => [s.key, Number(draft[s.key])])));
      }}
    >
      {SETTINGS.map((s) => (
        <label key={s.key} className="form__label">
          {s.label}
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={s.min}
            max={s.max}
            step={1}
            value={draft[s.key]}
            onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
          />
        </label>
      ))}
      <button className="button" type="submit" disabled={!changed}>
        Save settings
      </button>
    </form>
  );
}
