// Socket.IO protocol. Clients only send requests; the server validates, applies them to the match,
// and pushes a full, role-filtered `state` snapshot to everyone affected.
//
// Every request uses an ack callback: { ok: true, ...data } or { ok: false, error: { code, message } }.
// Roles are checked here on the server for every request, never trusted from the client.
// The full message reference is in docs/PROTOCOL.md.

import {
  GameError,
  addAnnouncement,
  addTeam,
  configureMatch,
  patchTeam,
  removeTeam,
  setAllocation,
  setAutonomous,
  setFocus,
} from '../game/match.js';
import { computeRace } from '../game/race.js';
import { gmView, guestView, spectatorView, teamView } from './views.js';

/**
 * @param {import('socket.io').Server} io
 * @param {object} ctx
 * @param {import('../game/model.js').Match} ctx.match
 * @param {ReturnType<import('../events/engine.js').createEventEngine>} ctx.engine
 * @param {ReturnType<import('./auth.js').createSessions>} ctx.sessions
 * @param {ReturnType<import('./auth.js').createPasswordGate>} ctx.gate
 * @param {{ gmPassword: string, spectatorPassword: string }} ctx.config
 * @param {{ count: number, warnings: string[], errors: string[] }} ctx.eventsStatus
 * @param {ReturnType<import('../phases.js').createPhaseLoop>} ctx.loop  all match lifecycle changes go through it
 * @param {Pick<Console, 'info' | 'warn' | 'error'>} ctx.log
 */
export function attachSockets(io, ctx) {
  const { match, engine, sessions, gate, config, loop, log } = ctx;

  const roomFor = (session) => (session ? (session.role === 'team' ? `team:${session.teamId}` : session.role) : 'guest');
  const roomSize = (room) => io.sockets.adapter.rooms.get(room)?.size ?? 0;

  function bind(socket, session, token = null) {
    for (const room of socket.rooms) if (room !== socket.id) socket.leave(room);
    socket.data.session = session ? { ...session, token } : null;
    socket.join(roomFor(session));
  }

  function viewFor(session) {
    if (!session) return guestView(match);
    if (session.role === 'gm') return gmView(match, engine, { online: onlineCounts(), events: ctx.eventsStatus, loop: loop.status() });
    if (session.role === 'spectator') return spectatorView(match);
    return teamView(match, engine, session.teamId);
  }

  function onlineCounts() {
    return {
      teams: Object.fromEntries(match.teams.map((t) => [t.id, roomSize(`team:${t.id}`)])),
      gm: roomSize('gm'),
      spectators: roomSize('spectator'),
      guests: roomSize('guest'),
    };
  }

  // ---- Broadcasting ----------------------------------------------------------------------

  let broadcastQueued = false;

  /** Push fresh state to every connected client. Coalesces multiple calls in the same tick. */
  function broadcast() {
    if (broadcastQueued) return;
    broadcastQueued = true;
    setImmediate(() => {
      broadcastQueued = false;
      if (roomSize('gm')) io.to('gm').emit('state', viewFor({ role: 'gm' }));
      if (roomSize('spectator')) io.to('spectator').emit('state', spectatorView(match));
      if (roomSize('guest')) io.to('guest').emit('state', guestView(match));
      for (const team of match.teams) {
        if (roomSize(`team:${team.id}`)) io.to(`team:${team.id}`).emit('state', teamView(match, engine, team.id));
      }
    });
  }

  /** Detach every socket of teams that no longer exist and revoke their tokens. */
  function endTeamSessions(teamIds, reason) {
    sessions.revokeTeams(teamIds);
    for (const teamId of teamIds) {
      // Copy: bind() removes sockets from the room while we iterate.
      for (const socketId of [...(io.sockets.adapter.rooms.get(`team:${teamId}`) ?? [])]) {
        const s = io.sockets.sockets.get(socketId);
        if (!s) continue;
        s.emit('session:ended', { reason });
        bind(s, null);
      }
    }
  }

  // ---- Request handling ----------------------------------------------------------------

  /**
   * @param {'guest' | 'team' | 'gm' | 'spectator' | 'any'} role who may send this request
   */
  function on(socket, event, role, handler) {
    socket.on(event, async (payload, ack) => {
      if (typeof payload === 'function') [payload, ack] = [undefined, payload];
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const session = socket.data.session;
        if (role === 'guest' && session) throw new GameError('already_authenticated', 'Already signed in');
        if (role !== 'guest' && role !== 'any' && session?.role !== role) {
          throw new GameError('forbidden', `Only ${role === 'gm' ? 'the Game Master' : `a ${role}`} can do that`);
        }
        const result = await handler(payload && typeof payload === 'object' ? payload : {}, socket);
        reply({ ok: true, ...result });
        broadcast();
      } catch (err) {
        if (err instanceof GameError) {
          reply({ ok: false, error: { code: err.code, message: err.message } });
        } else {
          log.error(`[socket] ${event} failed:`, err);
          reply({ ok: false, error: { code: 'internal', message: 'Server error' } });
        }
      }
    });
  }

  const clientId = (socket) => socket.handshake.address || socket.id;

  function requireRace() {
    if (!match.race) throw new GameError('no_race', 'Start the competition first');
    return match.race;
  }

  // A session token in the handshake (`auth: { token }`) re-attaches a reconnecting client.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const session = sessions.get(token);
    socket.data.pendingSession = session ? { session, token } : null;
    socket.data.invalidToken = Boolean(token) && !session;
    next();
  });

  io.on('connection', (socket) => {
    const pending = socket.data.pendingSession;
    // A token whose team was removed (e.g. reset without teams) is stale.
    const stillValid = pending && (pending.session.role !== 'team' || match.teams.some((t) => t.id === pending.session.teamId));
    bind(socket, stillValid ? pending.session : null, stillValid ? pending.token : null);
    if (socket.data.invalidToken || (pending && !stillValid)) socket.emit('session:invalid');

    // -- anyone --
    on(socket, 'state:request', 'any', async () => {
      socket.emit('state', viewFor(socket.data.session));
      return {};
    });

    // -- guests --
    on(socket, 'team:join', 'guest', async ({ name }) => {
      if (typeof name !== 'string' || !name.trim()) throw new GameError('invalid_name', 'Enter a team name');
      const team = addTeam(match, { name });
      const token = sessions.create('team', team.id);
      bind(socket, { role: 'team', teamId: team.id }, token);
      log.info(`[socket] team joined: ${team.name} (${team.id})`);
      return { token, teamId: team.id };
    });

    on(socket, 'gm:login', 'guest', async ({ password }) => {
      gate.check(`gm:${clientId(socket)}`, password, config.gmPassword);
      const token = sessions.create('gm');
      bind(socket, { role: 'gm', teamId: null }, token);
      log.info('[socket] GM signed in');
      return { token };
    });

    on(socket, 'spectator:login', 'guest', async ({ password }) => {
      gate.check(`spectator:${clientId(socket)}`, password, config.spectatorPassword);
      const token = sessions.create('spectator');
      bind(socket, { role: 'spectator', teamId: null }, token);
      return { token };
    });

    on(socket, 'session:logout', 'any', async () => {
      const session = socket.data.session;
      if (!session) return {};
      if (session.role === 'team') throw new GameError('forbidden', 'Teams leave with team:leave (lobby only)');
      sessions.revoke(session.token);
      bind(socket, null);
      return {};
    });

    // -- teams --
    on(socket, 'team:leave', 'team', async () => {
      const { teamId } = socket.data.session;
      removeTeam(match, teamId);
      endTeamSessions([teamId], 'left');
      return {};
    });

    on(socket, 'team:allocate', 'team', async ({ personnel }) => {
      setAllocation(match, socket.data.session.teamId, personnel);
      return {};
    });

    on(socket, 'team:focus', 'team', async ({ performance }) => {
      setFocus(match, socket.data.session.teamId, performance);
      return {};
    });

    on(socket, 'team:setAutonomous', 'team', async ({ enabled }) => {
      setAutonomous(match, socket.data.session.teamId, enabled);
      return {};
    });

    on(socket, 'team:answer', 'team', async ({ instanceId, optionId }) => {
      engine.answerDecision(match, socket.data.session.teamId, instanceId, optionId);
      return {};
    });

    // -- Game Master: match lifecycle (through the phase loop, which owns the timers) --
    on(socket, 'gm:configure', 'gm', async (settings) => {
      return { config: { ...configureMatch(match, settings) } };
    });

    on(socket, 'gm:start', 'gm', async () => {
      loop.start();
      return {};
    });

    on(socket, 'gm:pause', 'gm', async () => {
      loop.pause();
      return {};
    });

    on(socket, 'gm:resume', 'gm', async () => {
      loop.resume();
      return {};
    });

    on(socket, 'gm:advance', 'gm', async () => {
      loop.advance();
      return {};
    });

    on(socket, 'gm:addTime', 'gm', async ({ seconds }) => {
      loop.addTime(seconds);
      return {};
    });

    on(socket, 'gm:end', 'gm', async () => {
      loop.end();
      return {};
    });

    on(socket, 'gm:reset', 'gm', async ({ keepTeams = true }) => {
      const before = match.teams.map((t) => t.id);
      loop.reset({ keepTeams: keepTeams !== false });
      const removed = before.filter((id) => !match.teams.some((t) => t.id === id));
      if (removed.length) endTeamSessions(removed, 'reset');
      return {};
    });

    on(socket, 'gm:removeTeam', 'gm', async ({ teamId }) => {
      removeTeam(match, teamId);
      endTeamSessions([teamId], 'removed');
      return {};
    });

    on(socket, 'gm:trigger', 'gm', async ({ eventId, teamIds, respectConditions }) => {
      const results = engine.trigger(match, eventId, {
        teamIds: Array.isArray(teamIds) ? teamIds : undefined,
        respectConditions: respectConditions === true,
      });
      return { results };
    });

    // -- Game Master: the end-of-season competition --
    on(socket, 'gm:startRace', 'gm', async () => {
      if (match.status !== 'ended') throw new GameError('not_ended', 'The competition runs after the last round');
      if (match.race) throw new GameError('race_started', 'The competition has already been run');
      if (!match.teams.length) throw new GameError('no_teams', 'No teams to race');
      match.race = computeRace(match);
      log.info(`[race] computed ${match.race.steps.length} steps for ${match.teams.length} teams`);
      return { steps: match.race.steps.length };
    });

    on(socket, 'gm:raceAdvance', 'gm', async () => {
      const race = requireRace();
      race.step = Math.min(race.step + 1, race.steps.length - 1);
      if (race.step === race.steps.length - 1) race.status = 'finished';
      return { step: race.step };
    });

    on(socket, 'gm:raceBack', 'gm', async () => {
      const race = requireRace();
      race.step = Math.max(0, race.step - 1);
      race.status = 'revealing';
      return { step: race.step };
    });

    // -- Game Master: live fixes and announcements --
    on(socket, 'gm:patchTeam', 'gm', async ({ teamId, ...patch }) => {
      return { changes: patchTeam(match, teamId, patch) };
    });

    on(socket, 'gm:post', 'gm', async ({ text }) => {
      const post = addAnnouncement(match, text);
      log.info(`[socket] GM posted: ${post.text}`);
      return { post };
    });

    /** Why each team would or wouldn't get this event right now (nothing is changed). */
    on(socket, 'gm:explain', 'gm', async ({ eventId }) => {
      return { teams: match.teams.map((team) => ({ teamId: team.id, ...engine.explain(match, eventId, team.id) })) };
    });

    on(socket, 'gm:reloadEvents', 'gm', async () => {
      const result = engine.reload();
      ctx.setEventsStatus(result);
      return { reload: { ok: result.ok, count: result.count ?? null, errors: result.errors, warnings: result.warnings } };
    });

    socket.on('disconnect', () => broadcast());

    socket.emit('state', viewFor(socket.data.session));
    broadcast(); // online counts changed for the GM
  });

  return { broadcast };
}
