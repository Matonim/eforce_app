import { useGame } from '../net/game.js';
import { ConnectionDot, InlineForm } from '../components/common.jsx';
import GmDashboard from '../gm/GmDashboard.jsx';

export default function GmView() {
  const { connected, state, request } = useGame('gm');

  if (state?.role === 'gm') {
    return (
      <main className="app app--gm">
        <GmDashboard state={state} request={request} connected={connected} />
      </main>
    );
  }

  return (
    <main className="app app--join">
      <header className="bar">
        <h1>Game Master</h1>
        <ConnectionDot connected={connected} />
      </header>
      {!state && <p className="muted">Connecting…</p>}
      {state && (
        <section className="card">
          <InlineForm
            label="GM password"
            type="password"
            submitLabel="Sign in"
            autoComplete="current-password"
            onSubmit={(password) => request('gm:login', { password })}
          />
        </section>
      )}
    </main>
  );
}
