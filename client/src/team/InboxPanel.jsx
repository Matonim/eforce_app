import { useState } from 'react';
import { describeChange } from '../lib/format.js';

const RECENT_ROUNDS = 3;

/** The team's private event history, newest round first. */
export function InboxPanel({ me, labels }) {
  const [showAll, setShowAll] = useState(false);
  const rounds = [...new Set(me.eventLog.map((e) => e.round))].sort((a, b) => b - a);
  const visible = showAll ? rounds : rounds.slice(0, RECENT_ROUNDS);

  return (
    <section className="card">
      <div className="card__head">
        <h2>Team inbox</h2>
        <span className="muted small">Only your team sees this.</span>
      </div>
      {!rounds.length && <p className="muted">Nothing yet. Events that hit your team will show up here.</p>}
      {visible.map((round) => (
        <div key={round} className="inbox__round">
          <h3 className="subhead">{round === 0 ? 'Before the start' : `Round ${round}`}</h3>
          <ul className="inbox">
            {me.eventLog
              .filter((e) => e.round === round)
              .reverse()
              .map((entry, i) => (
                <InboxItem key={i} entry={entry} labels={labels} />
              ))}
          </ul>
        </div>
      ))}
      {rounds.length > RECENT_ROUNDS && (
        <button className="link" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show recent rounds only' : `Show all ${rounds.length} rounds`}
        </button>
      )}
    </section>
  );
}

const ICONS = { event: '⚡', decision: '✔', ongoing: '⟳', gm: '🛠' };

export function InboxItem({ entry, labels }) {
  const changes = entry.changes.map((c) => describeChange(c, labels));
  return (
    <li className={`inbox__item inbox__item--${entry.kind}`}>
      <span className="inbox__icon" aria-hidden="true">
        {ICONS[entry.kind]}
      </span>
      <div className="inbox__body">
        <strong>
          {entry.title}
          {entry.kind === 'decision' && entry.choiceLabel && <span className="muted"> → {entry.choiceLabel}</span>}
        </strong>
        {entry.text && entry.kind !== 'ongoing' && <p>{entry.text}</p>}
        {entry.decisionId && <p className="muted small">Needs your decision.</p>}
        {changes.length > 0 && (
          <span className="option__effects">
            {changes.map((line, i) => (
              <span key={i} className={`chip chip--${line.ongoing ? 'ongoing' : line.tone}`}>
                {line.ongoing ? '⟳ ' : ''}
                {line.text}
              </span>
            ))}
          </span>
        )}
      </div>
    </li>
  );
}
