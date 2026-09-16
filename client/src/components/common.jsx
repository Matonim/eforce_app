import { useEffect, useMemo, useState } from 'react';

export function ConnectionDot({ connected }) {
  return <span className={`dot ${connected ? 'dot--on' : ''}`} title={connected ? 'Connected' : 'Offline'} />;
}

/**
 * Milliseconds left in the current phase, ticking locally. The server sends an absolute `phaseEndsAt`
 * plus its own clock (`serverTime`), so a phone with a wrong clock still counts down correctly.
 * Returns null when no timer applies (lobby, ended).
 */
export function useCountdown(match, serverTime) {
  const offset = useMemo(() => (serverTime ? serverTime - Date.now() : 0), [serverTime]);
  const [, rerender] = useState(0);
  const running = match?.status === 'running' && match.phaseEndsAt != null;

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => rerender((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [running]);

  if (match?.status === 'paused') return match.pausedRemainingMs;
  if (!running) return null;
  return Math.max(0, match.phaseEndsAt - (Date.now() + offset));
}

export function formatDuration(ms) {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const PHASE_LABELS = { lobby: 'Lobby', decision: 'Decision phase', resolution: 'Round results', ended: 'Match ended' };

export function PhaseLine({ match, serverTime }) {
  const remaining = useCountdown(match, serverTime);
  if (!match) return null;
  const paused = match.status === 'paused';
  const urgent = !paused && match.phase === 'decision' && remaining != null && remaining <= 10_000;

  return (
    <div className={`phase ${urgent ? 'phase--urgent' : ''}`}>
      <span>
        <strong>
          {paused && 'Paused · '}
          {PHASE_LABELS[match.phase] ?? match.phase}
        </strong>
        {match.round > 0 && (
          <span className="muted">
            {' '}
            · round {match.round}/{match.totalRounds}
          </span>
        )}
      </span>
      {remaining != null && (
        <span className="phase__timer" aria-live="off">
          {formatDuration(remaining)}
          <span className="phase__hint">
            {match.phase !== 'resolution' ? ' left' : match.round >= match.totalRounds ? ' until final standings' : ' until next round'}
          </span>
        </span>
      )}
    </div>
  );
}

/** Single-field form with async submit and inline error display. */
export function InlineForm({ label, type = 'text', placeholder, submitLabel, maxLength, autoComplete, onSubmit, disabled }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label className="form__label">
        {label}
        <input
          className="input"
          type={type}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete={autoComplete}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled || busy}
        />
      </label>
      <button className="button" type="submit" disabled={disabled || busy || !value.trim()}>
        {busy ? '…' : submitLabel}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

export function Feed({ feed, teams }) {
  const byId = Object.fromEntries((teams ?? []).map((t) => [t.id, t]));
  if (!feed?.length) return <p className="muted">No posts yet.</p>;
  return (
    <ul className="feed">
      {[...feed].reverse().map((post) => {
        const fromGm = post.source === 'gm' || !post.teamId;
        return (
          <li
            key={post.id}
            className={`feed__post ${fromGm ? 'feed__post--gm' : ''}`}
            style={fromGm ? undefined : { borderLeftColor: byId[post.teamId]?.color }}
          >
            <span className="feed__meta">
              <span className={fromGm ? 'feed__author--gm' : undefined}>
                {fromGm ? 'Race Control' : (byId[post.teamId]?.name ?? 'Unknown team')}
              </span>
              {post.round > 0 && ` · round ${post.round}`}
            </span>
            {post.text}
          </li>
        );
      })}
    </ul>
  );
}

export function Standings({ standings }) {
  if (!standings) return null;
  return (
    <ol className="standings">
      {standings.map((row) => (
        <li key={row.teamId}>
          <span className="swatch" style={{ background: row.color }} /> {row.name} — <strong>{row.score}</strong>
        </li>
      ))}
    </ol>
  );
}

/** Raw state for debugging until the real UIs land (steps 6, 7, 10). */
export function StateDump({ state }) {
  return (
    <details className="card">
      <summary>Raw state</summary>
      <pre className="dump">{JSON.stringify(state, null, 2)}</pre>
    </details>
  );
}
