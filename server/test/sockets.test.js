import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createGameServer } from '../src/app.js';

const GM_PASSWORD = 'gm-test-password';
const SPECTATOR_PASSWORD = 'spectator-test-password';
const silent = { info() {}, warn() {}, error: console.error };

const events = [
  {
    id: 'sponsor',
    title: 'Sponsor',
    text: 'Private details about the deal.',
    weight: 1,
    effects: { budget: 1000, 'flags.secret': true },
    post: '{team} signs a €{change.budget} deal',
    followUp: { event: 'aftermath', inRounds: 3 },
  },
  { id: 'aftermath', title: 'Aftermath', text: 'x', weight: 0, effects: { budget: -1 } },
  {
    id: 'choice',
    title: 'Choice',
    text: 'Pick one',
    weight: 1,
    decision: {
      prompt: '?',
      options: [
        { id: 'a', label: 'A', effects: { budget: 5 } },
        { id: 'b', label: 'B' },
      ],
      onTimeout: { option: 'b' },
    },
  },
];

let server;
let url;
const clients = [];

before(async () => {
  server = createGameServer({
    gmPassword: GM_PASSWORD,
    spectatorPassword: SPECTATOR_PASSWORD,
    seed: 'socket-test',
    engineOptions: { events, rolls: { teamEventChance: 0, globalEventChance: 0 } },
    gate: { maxAttempts: 3, lockMs: 60_000 },
    log: silent,
  });
  const port = await server.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${port}`;
});

after(async () => {
  for (const c of clients) c.close();
  await server.close();
});

/** Connect and resolve once the first state snapshot arrives. `client.state` always holds the latest. */
function client(token) {
  const socket = connect(url, { auth: token ? { token } : {}, transports: ['websocket'], forceNew: true });
  clients.push(socket);
  socket.events = [];
  socket.onAny((event, payload) => {
    socket.events.push(event);
    if (event === 'state') socket.state = payload;
  });
  return new Promise((resolve) => socket.once('state', () => resolve(socket)));
}

const request = (socket, event, payload = {}) => socket.timeout(2000).emitWithAck(event, payload);

/** Wait until the client's latest state satisfies the predicate. */
function until(socket, predicate) {
  if (socket.state && predicate(socket.state)) return Promise.resolve(socket.state);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('state predicate timed out')), 2000);
    const check = (state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off('state', check);
      resolve(state);
    };
    socket.on('state', check);
  });
}

// Tests share one server and run in order: lobby → join → start → in-match.

test('guests see the lobby and can join with a unique name', async () => {
  const guest = await client();
  assert.equal(guest.state.role, 'guest');
  assert.equal(guest.state.joinable, true);

  const empty = await request(guest, 'team:join', { name: '   ' });
  assert.equal(empty.error.code, 'invalid_name');

  const joined = await request(guest, 'team:join', { name: 'Prague Racing' });
  assert.equal(joined.ok, true);
  assert.ok(joined.token);
  const state = await until(guest, (s) => s.role === 'team');
  assert.equal(state.me.name, 'Prague Racing');

  const other = await client();
  const dup = await request(other, 'team:join', { name: 'prague racing' });
  assert.equal(dup.error.code, 'name_taken');
  assert.equal((await request(other, 'team:join', { name: 'Munich Motorsport' })).ok, true);
});

test('reconnecting with a token restores the team; a bad token is reported', async () => {
  const fresh = await client();
  const { token, teamId } = await request(fresh, 'team:join', { name: 'Graz Speed' });
  fresh.close();

  const back = await client(token);
  assert.equal(back.state.role, 'team');
  assert.equal(back.state.me.id, teamId);

  const stale = await client('not-a-real-token');
  assert.equal(stale.state.role, 'guest');
  assert.ok(stale.events.includes('session:invalid'));
});

test('teams can leave in the lobby, which revokes their token', async () => {
  const leaver = await client();
  const { token } = await request(leaver, 'team:join', { name: 'Leaving Soon' });
  assert.equal((await request(leaver, 'team:leave')).ok, true);
  await until(leaver, (s) => s.role === 'guest');
  assert.ok(leaver.events.includes('session:ended'));
  const again = await client(token);
  assert.equal(again.state.role, 'guest');
});

test('GM login: wrong password and server-side role checks', async () => {
  const intruder = await client();
  assert.equal((await request(intruder, 'gm:start')).error.code, 'forbidden');

  const team = await client();
  await request(team, 'team:join', { name: 'Sneaky Team' });
  assert.equal((await request(team, 'gm:start')).error.code, 'forbidden');
  assert.equal((await request(team, 'gm:login', { password: GM_PASSWORD })).error.code, 'already_authenticated');

  assert.equal((await request(intruder, 'gm:login', { password: 'nope' })).error.code, 'invalid_password');
  assert.equal((await request(intruder, 'spectator:login', { password: GM_PASSWORD })).error.code, 'invalid_password');

  const gm = await client();
  const ok = await request(gm, 'gm:login', { password: GM_PASSWORD });
  assert.equal(ok.ok, true);
  const state = await until(gm, (s) => s.role === 'gm');
  assert.ok(state.match.teams.length >= 3);
  assert.ok(state.events.definitions.some((d) => d.id === 'sponsor'));
  assert.ok(state.online.teams);

  const reconnect = await client(ok.token);
  assert.equal(reconnect.state.role, 'gm');
});

test('match flow: late joins rejected, events private, posts public, no secrets leak', async () => {
  const gm = await client();
  await request(gm, 'gm:login', { password: GM_PASSWORD });
  await until(gm, (s) => s.role === 'gm');

  const alpha = await client();
  const alphaJoin = await request(alpha, 'team:join', { name: 'Alpha' });
  const alphaId = alphaJoin.teamId;
  const beta = await client();
  const betaJoin = await request(beta, 'team:join', { name: 'Beta' });

  const spectator = await client();
  const spectatorLogin = await request(spectator, 'spectator:login', { password: SPECTATOR_PASSWORD });
  assert.equal(spectatorLogin.ok, true);
  await until(spectator, (s) => s.role === 'spectator');

  assert.equal((await request(gm, 'gm:start')).ok, true);
  await until(alpha, (s) => s.match.status === 'running');

  const late = await client();
  assert.equal(late.state.joinable, false);
  assert.equal((await request(late, 'team:join', { name: 'Too Late' })).error.code, 'not_lobby');

  const trigger = await request(gm, 'gm:trigger', { eventId: 'sponsor', teamIds: [alphaId] });
  assert.equal(trigger.ok, true);

  const alphaState = await until(alpha, (s) => s.feed.length > 0);
  const betaState = await until(beta, (s) => s.feed.length > 0);

  // Public snippet reaches everyone, with the rendered amount.
  assert.equal(betaState.feed.at(-1).text, 'Alpha signs a €1,000 deal');
  const spectatorState = await until(spectator, (s) => s.feed.length > 0);
  assert.equal(spectatorState.feed.at(-1).text, 'Alpha signs a €1,000 deal');
  assert.deepEqual(Object.keys(spectatorState.teams[0]).sort(), ['color', 'id', 'location', 'name']);
  assert.equal(spectatorState.me, undefined);

  // The private event log only exists for the affected team; flags and follow-up internals are stripped.
  assert.ok(alphaState.me.eventLog.some((e) => e.eventId === 'sponsor'));
  assert.equal(betaState.me.eventLog.length, 0);
  const alphaEntry = alphaState.me.eventLog.find((e) => e.eventId === 'sponsor');
  assert.equal(alphaEntry.source, undefined);
  assert.ok(alphaEntry.changes.every((c) => !c.path.startsWith('flags.')));

  // Other teams are identities only.
  const alphaAsSeenByBeta = betaState.teams.find((t) => t.id === alphaId);
  assert.deepEqual(Object.keys(alphaAsSeenByBeta).sort(), ['color', 'id', 'location', 'name']);
  for (const state of [alphaState, betaState, spectatorState]) {
    const json = JSON.stringify(state);
    assert.ok(!json.includes('scheduledEvents'), 'follow-ups never reach teams or spectators');
    assert.ok(!json.includes('"flags"'), 'flags never reach teams or spectators');
    assert.ok(!json.includes('Private details about the deal') || state === alphaState, 'event text stays private');
    assert.equal(state.standings, null, 'no standings during the match');
  }

  // The GM sees everything, including the scheduled follow-up.
  const gmState = await until(gm, (s) => s.match.feed.length > 0);
  assert.equal(gmState.match.teams.find((t) => t.id === alphaId).scheduledEvents[0].eventId, 'aftermath');

  // Tokens never appear in any payload.
  const tokens = [alphaJoin.token, betaJoin.token, spectatorLogin.token];
  assert.equal(tokens.filter(Boolean).length, 3);
  for (const socket of [alpha, beta, spectator, gm]) {
    for (const token of tokens) assert.ok(!JSON.stringify(socket.state).includes(token));
  }
});

test('teams send decisions; invalid input is rejected with error codes', async () => {
  const gm = await client();
  await request(gm, 'gm:login', { password: GM_PASSWORD });
  const player = clients.find((c) => c.state?.role === 'team' && c.state.me.name === 'Beta');

  const bad = await request(player, 'team:allocate', { personnel: { aero: 999 } });
  assert.equal(bad.error.code, 'invalid_allocation');
  assert.equal((await request(player, 'team:focus', { performance: 70 })).ok, true);
  await until(player, (s) => s.me.focus.performance === 70);

  const teamId = player.state.me.id;
  await request(gm, 'gm:trigger', { eventId: 'choice', teamIds: [teamId] });
  const withDecision = await until(player, (s) => s.me.decisions.length === 1);
  const { instanceId } = withDecision.me.decisions[0];
  assert.equal((await request(player, 'team:answer', { instanceId, optionId: 'zzz' })).error.code, 'unknown_option');
  assert.equal((await request(player, 'team:answer', { instanceId, optionId: 'a' })).ok, true);
  await until(player, (s) => s.me.decisions[0]?.choice === 'a');

  // The GM skips the (long) decision timer; the recorded answer is applied in the resolution.
  assert.equal((await request(player, 'gm:advance')).error.code, 'forbidden');
  assert.equal((await request(gm, 'gm:advance')).ok, true);
  await until(player, (s) => s.match.phase === 'resolution');
  const resolved = await until(player, (s) => s.me.eventLog.some((e) => e.kind === 'decision'));
  assert.equal(resolved.me.eventLog.find((e) => e.kind === 'decision').choice, 'a');

  const late = await request(player, 'team:focus', { performance: 10 });
  assert.equal(late.error.code, 'decisions_closed');
});

test('GM reset without teams ends team sessions; season standings are for the GM only', async () => {
  const gm = await client();
  await request(gm, 'gm:login', { password: GM_PASSWORD });
  const player = clients.find((c) => c.state?.role === 'team' && c.connected);

  assert.equal((await request(gm, 'gm:end')).ok, true);
  const ended = await until(player, (s) => s.match.status === 'ended');
  assert.equal(ended.standings, null, 'teams wait for the competition');
  const gmEnded = await until(gm, (s) => s.match.status === 'ended');
  assert.ok(gmEnded.standings.length >= 2);
  assert.equal(gmEnded.standings[0].source, 'season');

  assert.equal((await request(gm, 'gm:reset', { keepTeams: false })).ok, true);
  await until(player, (s) => s.role === 'guest' && s.joinable);
  assert.ok(player.events.includes('session:ended'));
});

// Runs last: it locks password logins for 127.0.0.1, which every client in this file shares.
test('password lockout after repeated failures', async () => {
  const brute = await client();
  for (let i = 0; i < 3; i++) await request(brute, 'spectator:login', { password: `guess-${i}` });
  const locked = await request(brute, 'spectator:login', { password: SPECTATOR_PASSWORD });
  assert.equal(locked.error.code, 'too_many_attempts');
});

// ---- Step 7: GM live fixes, announcements and eligibility checks -------------------------------

test('GM can correct a budget, post to the feed, and ask why an event would not fire', async () => {
  const gm = await client();
  await request(gm, 'gm:login', { password: GM_PASSWORD });
  const player = await client();
  const { teamId } = await request(player, 'team:join', { name: 'Fixable' });
  await until(gm, (s) => s.match.teams.some((t) => t.id === teamId));

  // Budget edit: validated, applied, and visible to the team with a log entry.
  assert.equal((await request(gm, 'gm:patchTeam', { teamId, budget: 1.5 })).error.code, 'invalid_patch');
  assert.equal((await request(gm, 'gm:patchTeam', { teamId, stats: { performance: 99 } })).error.code, 'invalid_patch');
  assert.equal((await request(player, 'gm:patchTeam', { teamId, budget: 1 })).error.code, 'forbidden');

  const patched = await request(gm, 'gm:patchTeam', { teamId, budget: 12345 });
  assert.equal(patched.ok, true);
  assert.deepEqual(patched.changes.map((c) => c.path), ['budget']);
  const seen = await until(player, (s) => s.me.budget === 12345);
  const entry = seen.me.eventLog.at(-1);
  assert.equal(entry.kind, 'gm');
  assert.equal(entry.changes[0].to, 12345);

  // Announcements come from the organisers, not a team.
  assert.equal((await request(gm, 'gm:post', { text: '   ' })).error.code, 'invalid_post');
  assert.equal((await request(player, 'gm:post', { text: 'fake news' })).error.code, 'forbidden');
  assert.equal((await request(gm, 'gm:post', { text: 'Scrutineering opens in 10 minutes.' })).ok, true);
  const withPost = await until(player, (s) => s.feed.some((p) => p.source === 'gm'));
  const post = withPost.feed.at(-1);
  assert.equal(post.text, 'Scrutineering opens in 10 minutes.');
  assert.equal(post.teamId, null);

  // Explain answers per team without changing anything.
  const explained = await request(gm, 'gm:explain', { eventId: 'choice' });
  assert.deepEqual(explained.teams.map((t) => t.teamId), [teamId]);
  assert.equal(typeof explained.teams[0].eligible, 'boolean');
  assert.equal((await request(gm, 'gm:explain', { eventId: 'nope' })).error.code, 'unknown_event');
});

// ---- The end-of-season competition -------------------------------------------------------------

test('the competition runs after the last round and teams only see what has been announced', async () => {
  const gm = await client();
  await request(gm, 'gm:login', { password: GM_PASSWORD });
  const player = clients.find((c) => c.state?.role === 'team' && c.connected);
  assert.ok(player, 'a team is still connected');

  // Too early: the season has to finish first.
  assert.equal((await request(gm, 'gm:startRace')).error.code, 'not_ended');

  assert.equal((await request(gm, 'gm:configure', { totalRounds: 1 })).ok, true);
  await request(gm, 'gm:start');
  await request(gm, 'gm:advance'); // resolve round 1
  await request(gm, 'gm:advance'); // results → match ends
  await until(gm, (s) => s.match.status === 'ended');

  const started = await request(gm, 'gm:startRace');
  assert.equal(started.ok, true);
  assert.ok(started.steps > 20, 'a full reveal timeline');
  assert.equal((await request(gm, 'gm:startRace')).error.code, 'race_started');
  assert.equal((await request(player, 'gm:startRace')).error.code, 'forbidden');

  // The GM holds the whole result; the team only has the intro.
  const gmState = await until(gm, (s) => s.race != null);
  assert.equal(gmState.race.steps.length, started.steps);
  assert.ok(gmState.race.totals, 'the GM can see the totals to prepare');

  const teamStart = await until(player, (s) => s.race != null);
  assert.equal(teamStart.race.steps.length, 1);
  assert.equal(teamStart.race.steps[0].kind, 'intro');
  assert.equal(teamStart.race.totals, null, 'no peeking at the result');
  assert.equal(teamStart.race.totalSteps, started.steps);

  await request(gm, 'gm:raceAdvance');
  await request(gm, 'gm:raceAdvance');
  const revealed = await until(player, (s) => s.race.steps.length === 3);
  assert.equal(revealed.race.step, 2);
  assert.equal(revealed.race.steps.at(-1).disciplineId, 'design');

  assert.equal((await request(gm, 'gm:raceBack')).ok, true);
  await until(player, (s) => s.race.steps.length === 2);

  // Run it out to the podium: the standings then come from the race.
  for (let i = 0; i < started.steps; i++) await request(gm, 'gm:raceAdvance');
  const finished = await until(player, (s) => s.race.status === 'finished');
  assert.equal(finished.race.step, started.steps - 1);
  assert.equal(finished.race.steps.at(-1).kind, 'podium');
  assert.ok(finished.race.totals.length >= 1);
  assert.equal(finished.standings[0].source, 'race');
  assert.equal(finished.standings[0].score, finished.race.totals[0].total);
});

test('a team can start and stop the driverless programme', async () => {
  const gm = await client();
  await request(gm, 'gm:login', { password: GM_PASSWORD });
  await request(gm, 'gm:reset', { keepTeams: false });

  const player = await client();
  await request(player, 'team:join', { name: 'Driverless Devs' });
  const before = await until(player, (s) => s.role === 'team');
  assert.equal(before.me.autonomous, false);
  assert.equal(before.me.personnel.driverless, 0);

  // Staffing the department needs the programme first.
  const staff = { ...before.me.personnel, driverless: 1, aero: before.me.personnel.aero - 1 };
  assert.equal((await request(player, 'team:allocate', { personnel: staff })).error.code, 'needs_autonomous');

  assert.equal((await request(player, 'team:setAutonomous', { enabled: true })).ok, true);
  const running = await until(player, (s) => s.me.autonomous);
  assert.equal(running.me.budget, before.me.budget - running.rules.autonomous.setupCost);
  assert.equal(running.me.eventLog.at(-1).kind, 'programme');
  assert.equal((await request(player, 'team:allocate', { personnel: staff })).ok, true);

  // It can only be stopped once nobody is left in the department.
  assert.equal((await request(player, 'team:setAutonomous', { enabled: false })).error.code, 'driverless_staffed');
  assert.equal((await request(player, 'team:allocate', { personnel: { ...before.me.personnel } })).ok, true);
  assert.equal((await request(player, 'team:setAutonomous', { enabled: false })).ok, true);
  await until(player, (s) => s.me.autonomous === false);
});
