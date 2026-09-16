import { useEffect, useRef, useState } from 'react';
import { useAction } from '../lib/useAction.js';

const SAVE_DELAY_MS = 300;

/** Reliability ↔ performance slider. Saves shortly after the last movement. */
export function FocusPanel({ me, rules, open, request }) {
  const server = me.focus.performance;
  const [value, setValue] = useState(server);
  const pending = useRef(null);
  const action = useAction(request);

  // Follow the server unless the player is mid-change.
  useEffect(() => {
    if (!pending.current && !action.busy) setValue(server);
  }, [server, action.busy]);

  useEffect(() => () => clearTimeout(pending.current), []);

  const onChange = (next) => {
    setValue(next);
    clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      action.run('team:focus', { performance: next });
    }, SAVE_DELAY_MS);
  };

  const { min, max } = rules.focusMultiplier;
  const multiplier = (share) => min + (max - min) * (share / 100);
  const perf = multiplier(value);
  const rel = multiplier(100 - value);

  return (
    <section className="card">
      <div className="card__head">
        <h2>Focus</h2>
        <span className="muted small">{value === server && !action.busy ? 'Saved' : 'Saving…'}</span>
      </div>
      <div className="focus">
        <div className="focus__labels">
          <span>
            Reliability <strong>{100 - value}%</strong>
          </span>
          <span>
            <strong>{value}%</strong> Performance
          </span>
        </div>
        <input
          className="focus__slider"
          type="range"
          min={0}
          max={100}
          step={5}
          value={value}
          disabled={!open}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Focus: 0 is all reliability, 100 is all performance"
          aria-valuetext={`${100 - value}% reliability, ${value}% performance`}
        />
        <div className="focus__labels muted small">
          <span>Reliability gains ×{rel.toFixed(2)}</span>
          <span>Performance gains ×{perf.toFixed(2)}</span>
        </div>
      </div>
      {action.error && <p className="status-line status-line--error">Not saved: {action.error}</p>}
    </section>
  );
}
