import { describeEffect, describeModifier } from '../lib/format.js';

export function EffectsPanel({ me, labels }) {
  if (!me.activeEffects.length) return null;
  return (
    <section className="card">
      <h2>Active effects</h2>
      <ul className="effects">
        {me.activeEffects.map((effect) => (
          <li key={effect.id} className="effect">
            <span className="effect__head">
              <strong>⟳ {effect.label}</strong>
              <span className="muted small">
                {effect.roundsLeft} {effect.roundsLeft === 1 ? 'round' : 'rounds'} left
              </span>
            </span>
            <span className="option__effects">
              {Object.entries(effect.modifiers ?? {}).map(([key, value]) => {
                const line = describeModifier(key, value, labels);
                return (
                  <span key={key} className={`chip chip--${line.tone}`}>
                    {line.text}
                  </span>
                );
              })}
              {effect.perRound.map((e) => {
                const line = describeEffect(e, labels);
                return (
                  <span key={e.path} className={`chip chip--${line.tone}`}>
                    {line.text} per round
                  </span>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
