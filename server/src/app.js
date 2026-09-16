// Builds the whole game server (HTTP + Socket.IO + match + event engine) without listening,
// so index.js and the integration tests share exactly the same setup.

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { createMatch } from './game/match.js';
import { createEventEngine } from './events/engine.js';
import { createPasswordGate, createSessions } from './net/auth.js';
import { attachSockets } from './net/sockets.js';
import { createPhaseLoop } from './phases.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

/**
 * @param {object} options
 * @param {string} options.gmPassword
 * @param {string} options.spectatorPassword
 * @param {string} [options.seed]
 * @param {object} [options.matchConfig]    overrides for MATCH_DEFAULTS (tests use sub-second phases)
 * @param {object} [options.engineOptions]  passed to createEventEngine (tests use inline events)
 * @param {boolean} [options.watchEvents]    hot-reload data/events.json
 * @param {object} [options.gate]            password gate options (tests)
 * @param {object} [options.clock]           phase loop clock (tests)
 * @param {Pick<Console, 'info' | 'warn' | 'error'>} [options.log]
 */
export function createGameServer({
  gmPassword,
  spectatorPassword,
  seed = 'workshop',
  matchConfig = {},
  engineOptions = {},
  watchEvents = false,
  gate: gateOptions,
  clock,
  log = console,
}) {
  if (!gmPassword || !spectatorPassword) throw new Error('gmPassword and spectatorPassword are required');

  const engine = createEventEngine(engineOptions);
  const match = createMatch({ ...matchConfig, seed });

  const app = express();
  const httpServer = createServer(app);
  // No CORS: in development Vite proxies /socket.io, in production the client is same-origin.
  const io = new Server(httpServer);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, matchId: match.id, status: match.status, teams: match.teams.length });
  });

  // Serve the built client (team view at /, GM at /gm, spectator at /screen) when it exists.
  if (existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
  }

  const initial = engine.reload();
  const ctx = {
    match,
    engine,
    sessions: createSessions(),
    gate: createPasswordGate(gateOptions),
    config: { gmPassword, spectatorPassword },
    log,
    eventsStatus: { count: initial.count, errors: [], warnings: initial.warnings },
    setEventsStatus(result) {
      // A failed reload keeps the previous definitions, so keep the count of what is actually loaded.
      ctx.eventsStatus = { count: engine.list().length, errors: result.errors, warnings: result.warnings };
    },
  };
  // The loop needs broadcast (for timer-driven phase changes) and the sockets need the loop.
  ctx.loop = createPhaseLoop({ match, engine, clock, log, onChange: () => broadcast() });
  const { broadcast } = attachSockets(io, ctx);

  const stopWatching = watchEvents
    ? engine.watch((result) => {
        ctx.setEventsStatus(result);
        if (result.ok) log.info(`[events] reloaded ${result.count} events`);
        else log.error(`[events] reload failed, keeping previous definitions:\n  ${result.errors.join('\n  ')}`);
        broadcast();
      })
    : () => {};

  return {
    app,
    httpServer,
    io,
    match,
    engine,
    loop: ctx.loop,
    broadcast,
    eventsStatus: () => ctx.eventsStatus,
    /** @returns {Promise<number>} the bound port */
    listen(port = 0, host = '0.0.0.0') {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => resolve(httpServer.address().port));
      });
    },
    close() {
      stopWatching();
      ctx.loop.stop();
      return new Promise((resolve) => io.close(() => resolve()));
    },
  };
}
