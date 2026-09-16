import { useAction } from '../lib/useAction.js';
import { describeOutcome } from '../lib/format.js';

export function DecisionsPanel({ me, match, labels, open, request }) {
  if (!me.decisions.length) return null;
  return (
    <section className="card card--attention">
      <div className="card__head">
        <h2>
          {me.decisions.length === 1 ? 'Decision needed' : `${me.decisions.length} decisions needed`}
        </h2>
        <span className="muted small">
          {!open
            ? match.phase === 'resolution'
              ? 'Answer when the next round starts.'
              : ''
            : match.status === 'lobby'
              ? 'You can change your mind until the first round is resolved.'
              : 'Pick before the timer runs out. You can change your mind.'}
        </span>
      </div>
      {me.decisions.map((decision) => (
        <DecisionCard key={decision.instanceId} decision={decision} labels={labels} open={open} request={request} />
      ))}
    </section>
  );
}

function DecisionCard({ decision, labels, open, request }) {
  const action = useAction(request);
  const timeoutOption = decision.onTimeout.option && decision.options.find((o) => o.id === decision.onTimeout.option);

  return (
    <article className="decision">
      <h3>{decision.title}</h3>
      <p>{decision.text}</p>
      <p className="decision__prompt">{decision.prompt}</p>

      <div className="options" role="radiogroup" aria-label={decision.prompt}>
        {decision.options.map((option) => {
          const selected = decision.choice === option.id;
          return (
            <button
              key={option.id}
              className={`option ${selected ? 'option--selected' : ''}`}
              role="radio"
              aria-checked={selected}
              disabled={!open || !option.available || action.busy}
              onClick={() => action.run('team:answer', { instanceId: decision.instanceId, optionId: option.id })}
            >
              <span className="option__label">
                {option.label}
                {selected && <span className="badge badge--good">✓ Your choice</span>}
              </span>
              {option.description && <span className="option__description">{option.description}</span>}
              {!option.available && <span className="option__locked">🔒 {option.unavailableReason}</span>}
              <OutcomeLines preview={option.preview} labels={labels} />
            </button>
          );
        })}
      </div>

      <p className="muted small">
        If you don't answer:{' '}
        {timeoutOption
          ? timeoutOption.label
          : decision.onTimeout.preview
            ? describeOutcome(decision.onTimeout.preview, labels).map((l) => l.text).join(', ') || 'nothing changes'
            : 'something else happens'}
      </p>
      {action.error && <p className="status-line status-line--error">Not saved: {action.error}</p>}
    </article>
  );
}

function OutcomeLines({ preview, labels }) {
  if (!preview) return <span className="option__effects muted">Effects unknown</span>;
  const lines = describeOutcome(preview, labels);
  if (!lines.length) return <span className="option__effects muted">No direct effect</span>;
  return (
    <span className="option__effects">
      {lines.map((line) => (
        <span key={line.text} className={`chip chip--${line.ongoing ? 'ongoing' : line.tone}`}>
          {line.ongoing ? '⟳ ' : ''}
          {line.text}
        </span>
      ))}
    </span>
  );
}
