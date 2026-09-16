/** Event file health: what's loaded, what the last load complained about, and a reload button. */
export function EventsStatus({ state, run }) {
  const { events } = state;
  return (
    <section className="card">
      <div className="card__head">
        <h2>Event file</h2>
        <button className="button button--small button--ghost" onClick={() => run('gm:reloadEvents')}>
          Reload
        </button>
      </div>
      <p className="muted small">
        {events.count} events loaded from data/events.json. Saving the file reloads it automatically.
      </p>
      {events.errors.length > 0 && (
        <>
          <p className="error">The last reload failed, so the previous events are still running:</p>
          <ul className="issues">
            {events.errors.map((e) => (
              <li key={e} className="error">
                {e}
              </li>
            ))}
          </ul>
        </>
      )}
      {events.warnings.length > 0 && (
        <details>
          <summary className="notice">{events.warnings.length} warning(s)</summary>
          <ul className="issues">
            {events.warnings.map((w) => (
              <li key={w} className="notice">
                {w}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
