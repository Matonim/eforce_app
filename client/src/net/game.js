import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

// One socket per page, per view. The session token for that view is stored in localStorage and sent
// in the handshake, so a refresh or dropped connection re-attaches to the same team / GM / spectator
// session. The server always answers with a full `state` snapshot for this client's role.

const TOKEN_KEYS = { team: 'eforce.token.team', gm: 'eforce.token.gm', spectator: 'eforce.token.spectator' };

/**
 * `?slot=2` in the URL keeps a separate session for that tab, so several teams can be played from one
 * browser while testing (http://localhost:5173/?slot=1, ?slot=2, …). Without it, every tab of the
 * browser shares one team, which is what a participant's own device wants.
 */
export const SLOT = (() => {
  try {
    const value = new URLSearchParams(window.location.search).get('slot');
    return value && /^[A-Za-z0-9_-]{1,20}$/.test(value) ? value : null;
  } catch {
    return null;
  }
})();

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // private mode / storage disabled: the session just won't survive a refresh
    }
  },
};

const clients = new Map();

function getClient(view) {
  if (clients.has(view)) return clients.get(view);
  const tokenKey = SLOT ? `${TOKEN_KEYS[view]}.${SLOT}` : TOKEN_KEYS[view];
  // Same-origin: Express serves the client in production, Vite proxies /socket.io in development.
  const socket = io({ auth: (cb) => cb({ token: storage.get(tokenKey) }) });
  const client = { socket, tokenKey, state: null };
  socket.on('state', (state) => (client.state = state));
  socket.on('session:invalid', () => storage.set(tokenKey, null));
  socket.on('session:ended', () => storage.set(tokenKey, null));
  clients.set(view, client);
  return client;
}

export class RequestError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * @param {'team' | 'gm' | 'spectator'} view
 * @returns {{ connected: boolean, state: any, notice: string | null, request: (event: string, payload?: object) => Promise<any> }}
 */
export function useGame(view) {
  const client = getClient(view);
  const { socket, tokenKey } = client;
  const [connected, setConnected] = useState(socket.connected);
  const [state, setState] = useState(client.state);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onEnded = ({ reason } = {}) => setNotice(reason === 'reset' ? 'The Game Master reset the match.' : reason === 'removed' ? 'Your team was removed by the Game Master.' : null);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state', setState);
    socket.on('session:ended', onEnded);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state', setState);
      socket.off('session:ended', onEnded);
    };
  }, [socket]);

  const request = useCallback(
    async (event, payload = {}) => {
      let response;
      try {
        response = await socket.timeout(8000).emitWithAck(event, payload);
      } catch {
        throw new RequestError('timeout', 'No response from the server. Check your connection.');
      }
      if (!response.ok) throw new RequestError(response.error.code, response.error.message);
      if (response.token) storage.set(tokenKey, response.token);
      if (event === 'session:logout') storage.set(tokenKey, null);
      setNotice(null);
      return response;
    },
    [socket, tokenKey],
  );

  return { connected, state, notice, request };
}
