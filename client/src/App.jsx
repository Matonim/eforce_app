import TeamView from './views/TeamView.jsx';
import GmView from './views/GmView.jsx';
import SpectatorView from './views/SpectatorView.jsx';

// Path-based switch keeps this a single Vite app without a router dependency.
// /gm → Game Master dashboard, /screen → spectator (projector) view, anything else → team client.
export default function App() {
  const path = window.location.pathname;
  if (path.startsWith('/gm')) return <GmView />;
  if (path.startsWith('/screen')) return <SpectatorView />;
  return <TeamView />;
}
