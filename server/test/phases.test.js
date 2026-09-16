import { test } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createPhaseLoop } from '../src/phases.js';
import { createEventEngine } from '../src/events/engine.js';
import { addTeam, configureMatch, createMatch } from '../src/game/match.js';
import { createGameServer } from '../src/app.js';

const silent = { info() {}, warn() {}, error() {} };
const DECISION_MS = 60_000;
const RESOLUTION_MS = 10_000;

/** Deterministic clock: timers only run when tick() moves time forward. */
function fakeClock(start = 1_000_000) {
  let now = start;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      timers.set(++nextId, { at: now + Math.max(0, ms), fn });
      return nextId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    tick(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
    pending: () => timers.size,
  };
}

function setup({ totalRounds = 3, hooks } = {}) {
  const clock = fakeClock();
  const engine = hooks ? { hooks } : createEventEngine({ events: [{ id: 'e', title: 'E', text: 'e', weight: 1, effects: { budget: 1 } }], rolls: { teamEventChance: 0, globalEventChance: 0 } });
  const match = createMatch({ seed: 'phases', totalRounds, decisionSeconds: DECISION_MS / 1000, resolutionSeconds: RESOLUTION_MS / 1000 });
  addTeam(match, { name: 'Alpha' });
  addTeam(match, { name: 'Beta' });
  let changes = 0;
  const loop = createPhaseLoop({ match, engine, clock, log: silent, onChange: () => changes++ });
  return { clock, match, loop, changes: () => changes };
}

test('timer drives decision → resolution → next round with configured durations', () => {
  const { clock, match, loop, changes } = setup();
  loop.start();
  assert.equal(match.phase, 'decision');
  assert.equal(match.round, 1);
  assert.equal(match.phaseEndsAt, clock.now() + DECISION_MS);
  assert.equal(changes(), 1);

  clock.tick(DECISION_MS - 1);
  assert.equal(match.phase, 'decision', 'not before the timer runs out');

  clock.tick(1);
  assert.equal(match.phase, 'resolution');
  assert.equal(match.teams[0].history.length, 1, 'round was resolved');
  assert.equal(match.phaseEndsAt, clock.now() + RESOLUTION_MS);

  clock.tick(RESOLUTION_MS);
  assert.equal(match.phase, 'decision');
  assert.equal(match.round, 2);
  assert.equal(changes(), 3, 'every transition notifies');
  assert.equal(clock.pending(), 1, 'exactly one timer at a time');
});

test('a whole match runs to the end on its own and leaves no timers behind', () => {
  const { clock, match, loop } = setup({ totalRounds: 3 });
  loop.start();
  clock.tick(3 * (DECISION_MS + RESOLUTION_MS));
  assert.equal(match.status, 'ended');
  assert.equal(match.teams[0].history.length, 3);
  assert.equal(clock.pending(), 0);
  assert.equal(loop.status().timerArmed, false);
});

test('pause keeps the remaining time in both phases; resume continues from there', () => {
  const { clock, match, loop } = setup();
  loop.start();
  clock.tick(20_000);
  loop.pause();
  assert.equal(match.status, 'paused');
  assert.equal(match.pausedRemainingMs, DECISION_MS - 20_000);
  clock.tick(10 * DECISION_MS);
  assert.equal(match.phase, 'decision', 'nothing happens while paused');

  loop.resume();
  clock.tick(DECISION_MS - 20_000);
  assert.equal(match.phase, 'resolution');

  clock.tick(4_000);
  loop.pause();
  assert.equal(match.pausedRemainingMs, RESOLUTION_MS - 4_000);
  loop.resume();
  clock.tick(RESOLUTION_MS - 4_000);
  assert.equal(match.round, 2);
});

test('advance skips the current phase, un-pauses, and cancels the old timer', () => {
  const { clock, match, loop } = setup();
  assert.throws(() => loop.advance(), { code: 'not_running' });

  loop.start();
  loop.advance();
  assert.equal(match.phase, 'resolution');
  assert.equal(match.teams[0].history.length, 1);

  // The original decision timer must not resolve the round a second time.
  clock.tick(DECISION_MS);
  assert.equal(match.teams[0].history.length, 1);
  assert.equal(match.round, 2, 'resolution timer moved on normally');

  loop.pause();
  loop.advance();
  assert.equal(match.status, 'running');
  assert.equal(match.phase, 'resolution');
  assert.equal(clock.pending(), 1);
});

test('advance past the final resolution ends the match', () => {
  const { match, loop } = setup({ totalRounds: 1 });
  loop.start();
  loop.advance();
  loop.advance();
  assert.equal(match.status, 'ended');
  assert.throws(() => loop.advance(), { code: 'not_running' });
});

test('addTime moves the running timer, clamps at 1s, and adjusts a paused phase', () => {
  const { clock, match, loop } = setup();
  assert.throws(() => loop.addTime(30), { code: 'not_running' });
  loop.start();
  const end = match.phaseEndsAt;
  loop.addTime(30);
  assert.equal(match.phaseEndsAt, end + 30_000);
  clock.tick(DECISION_MS);
  assert.equal(match.phase, 'decision', 'extended');
  clock.tick(30_000);
  assert.equal(match.phase, 'resolution');

  loop.addTime(-600);
  assert.equal(match.phaseEndsAt, clock.now() + 1_000);
  assert.throws(() => loop.addTime(0), { code: 'invalid_seconds' });
  assert.throws(() => loop.addTime(1.5), { code: 'invalid_seconds' });

  loop.pause();
  const remaining = match.pausedRemainingMs;
  loop.addTime(15);
  assert.equal(match.pausedRemainingMs, remaining + 15_000);
});

test('end and reset clear the timer', () => {
  const { clock, match, loop } = setup();
  loop.start();
  loop.end();
  assert.equal(clock.pending(), 0);
  assert.equal(match.status, 'ended');

  loop.reset({ keepTeams: true });
  assert.equal(match.status, 'lobby');
  assert.equal(match.teams.length, 2);
  loop.start();
  loop.reset();
  assert.equal(clock.pending(), 0);
  clock.tick(DECISION_MS);
  assert.equal(match.status, 'lobby');
});

test('an exception during a timed transition pauses the match instead of crashing', () => {
  let explode = true;
  const { clock, match, loop } = setup({
    hooks: {
      afterProduction() {
        if (explode) throw new Error('boom');
      },
    },
  });
  loop.start();
  assert.doesNotThrow(() => clock.tick(DECISION_MS));
  assert.equal(match.status, 'paused');
  assert.match(loop.status().lastError, /boom/);
  assert.equal(match.pausedRemainingMs, RESOLUTION_MS, 'paused on the results screen');

  explode = false;
  loop.resume();
  clock.tick(RESOLUTION_MS);
  assert.equal(match.round, 2);
  assert.match(loop.status().lastError, /boom/, 'error stays visible to the GM until reset');
  loop.reset();
  assert.equal(loop.status().lastError, null);
});

test('sync re-arms from a restored snapshot', () => {
  const { clock, match, loop } = setup();
  loop.start();
  clock.tick(15_000);
  const snapshot = JSON.parse(JSON.stringify(match));
  loop.stop();

  const restored = createPhaseLoop({ match: snapshot, engine: { hooks: {} }, clock, log: silent });
  restored.sync();
  clock.tick(DECISION_MS - 15_000);
  assert.equal(snapshot.phase, 'resolution');
});

test('configureMatch: lobby only, whole numbers within limits', () => {
  const match = createMatch({ seed: 'cfg' });
  assert.deepEqual(
    { ...configureMatch(match, { totalRounds: 5, decisionSeconds: 90 }) },
    { ...match.config, totalRounds: 5, decisionSeconds: 90 },
  );
  assert.throws(() => configureMatch(match, { decisionSeconds: 5 }), { code: 'invalid_config' });
  assert.throws(() => configureMatch(match, { totalRounds: 2.5 }), { code: 'invalid_config' });
  assert.throws(() => configureMatch(match, { seed: 'x' }), { code: 'invalid_config' });
  addTeam(match, { name: 'A' });
  match.status = 'running';
  assert.throws(() => configureMatch(match, { totalRounds: 3 }), { code: 'not_lobby' });
});

test('socket server: real timers advance phases and broadcast; GM controls work', async () => {
  const server = createGameServer({
    gmPassword: 'gm',
    spectatorPassword: 'spec',
    seed: 'phase-socket',
    matchConfig: { totalRounds: 2, decisionSeconds: 0.3, resolutionSeconds: 0.2 },
    engineOptions: { events: [{ id: 'e', title: 'E', text: 'e', weight: 1, effects: { budget: 1 } }], rolls: { teamEventChance: 0, globalEventChance: 0 } },
    log: silent,
  });
  const port = await server.listen(0, '127.0.0.1');
  const sockets = [];
  const client = () =>
    new Promise((resolve) => {
      const socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
      sockets.push(socket);
      socket.on('state', (s) => (socket.state = s));
      socket.once('state', () => resolve(socket));
    });
  const request = (socket, event, payload = {}) => socket.timeout(2000).emitWithAck(event, payload);
  const until = (socket, predicate) =>
    new Promise((resolve, reject) => {
      if (socket.state && predicate(socket.state)) return resolve(socket.state);
      const timer = setTimeout(() => reject(new Error('timed out waiting for state')), 3000);
      const check = (s) => {
        if (!predicate(s)) return;
        clearTimeout(timer);
        socket.off('state', check);
        resolve(s);
      };
      socket.on('state', check);
    });

  try {
    const gm = await client();
    await request(gm, 'gm:login', { password: 'gm' });
    const team = await client();
    await request(team, 'team:join', { name: 'Timer Team' });

    assert.equal((await request(gm, 'gm:configure', { decisionSeconds: 5 })).error.code, 'invalid_config');
    assert.equal((await request(team, 'gm:configure', { totalRounds: 3 })).error.code, 'forbidden');

    await request(gm, 'gm:start');
    const decision = await until(team, (s) => s.match.phase === 'decision');
    assert.ok(decision.match.phaseEndsAt > decision.serverTime, 'clients get an end time to count down to');

    // No GM action: the timers alone move the match along.
    await until(team, (s) => s.match.phase === 'resolution' && s.match.round === 1);
    const round2 = await until(team, (s) => s.match.phase === 'decision' && s.match.round === 2);
    assert.equal(round2.me.history.length, 1);

    assert.equal((await request(gm, 'gm:pause')).ok, true);
    const paused = await until(team, (s) => s.match.status === 'paused');
    assert.ok(paused.match.pausedRemainingMs > 0);
    assert.equal((await request(gm, 'gm:addTime', { seconds: 30 })).ok, true);
    await until(gm, (s) => s.match.pausedRemainingMs > 30_000);

    // Advance while paused: resumes and resolves round 2, then the last resolution ends the match.
    assert.equal((await request(gm, 'gm:advance')).ok, true);
    await until(team, (s) => s.match.status === 'running' && s.match.phase === 'resolution' && s.match.round === 2);
    const ended = await until(team, (s) => s.match.status === 'ended');
    assert.equal(ended.standings, null, 'no season standings for teams');
    assert.equal((await until(gm, (s) => s.match.status === 'ended')).loop.timerArmed, false);
  } finally {
    for (const s of sockets) s.close();
    await server.close();
  }
});
