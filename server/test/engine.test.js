import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventEngine, EventDefinitionError } from '../src/events/engine.js';
import { checkConditions } from '../src/events/conditions.js';
import { createRng } from '../src/game/rng.js';
import { addTeam, advanceRound, createMatch, projectProduction, resolveRound, startMatch } from '../src/game/match.js';

const NO_ROLLS = { teamEventChance: 0, globalEventChance: 0 };

function setup({ events, teams = 2, rolls = NO_ROLLS, totalRounds = 10 }) {
  const engine = createEventEngine({ events, rolls });
  const match = createMatch({ seed: 'test', totalRounds });
  for (let i = 0; i < teams; i++) addTeam(match);
  for (const team of match.teams) {
    team.budget = 10000;
    team.personnel = { aero: 3, chassis: 2, powertrain: 2, electronics: 1, business: 2, driverless: 0 };
    team.stats = { performance: 50, reliability: 50, autonomy: 0 };
  }
  startMatch(match);
  return { engine, match, team: match.teams[0] };
}

/** Resolve the current round and move on to the next decision phase. */
function playRound(match, engine) {
  resolveRound(match, engine.hooks);
  advanceRound(match);
}

const ev = (overrides) => ({ id: 'e', title: 'E', text: 'e', weight: 1, effects: { budget: 1 }, ...overrides });

// ---- Conditions -----------------------------------------------------------------------

test('conditions: operators, any/not, flags, active and rank', () => {
  const { match, team } = setup({ events: [ev()] });
  match.teams[1].stats.performance = 80;
  team.flags.count = 2;
  team.activeEffects.push({ id: 'boost', sourceEventId: 'x', label: 'x', roundsLeft: 1 });
  const scope = { match, rng: createRng(match), ranks: null };
  const check = (c) => checkConditions(c, team, scope);

  assert.equal(check({ 'personnel.aero': 3 }), true);
  assert.equal(check({ 'personnel.aero': { min: 3, max: 3 } }), true);
  assert.equal(check({ 'personnel.aero': { min: 4 } }), false);
  assert.equal(check({ 'personnel.total': 10 }), true);
  assert.equal(check({ budget: { ne: 10000 } }), false);
  assert.equal(check({ 'location.id': { in: [team.location.id, 'nowhere'] } }), true);
  assert.equal(check({ 'location.id': { notIn: [team.location.id] } }), false);
  assert.equal(check({ any: [{ budget: { max: 0 } }, { round: 1 }] }), true);
  assert.equal(check({ not: { round: 1 } }), false);
  assert.equal(check({ 'flags.unset': false, 'flags.count': { min: 2 } }), true);
  assert.equal(check({ 'flags.unset': { max: 0 } }), true);
  assert.equal(check({ 'active.boost': true, 'active.other': false }), true);
  assert.equal(check({ 'rank.performance': 2 }), true);
});

// ---- Effects ------------------------------------------------------------------------------

test('effects: add, range, per, multiply, set, clamping and personnel selectors', () => {
  const { engine, match, team } = setup({
    events: [
      ev({
        id: 'all_ops',
        effects: {
          budget: { add: -100, per: 'personnel.total' },
          'stats.performance': 80,
          'stats.reliability': { multiply: 0.5 },
          'personnel.@largest': -1,
          'personnel.electronics': -5,
          'flags.hits': 1,
          'flags.mood': 'grim',
        },
      }),
      ev({ id: 'ranged', effects: { budget: [100, 200], 'personnel.business': { set: 7 } } }),
    ],
  });

  const [{ changes }] = engine.trigger(match, 'all_ops', { teamIds: [team.id] });
  assert.equal(team.budget, 9000);
  assert.equal(team.stats.performance, 100, 'clamped to max');
  assert.equal(team.stats.reliability, 25);
  assert.equal(team.personnel.aero, 2, '@largest resolves to aero');
  assert.equal(team.personnel.electronics, 0, 'personnel never negative');
  assert.deepEqual(team.flags, { hits: 1, mood: 'grim' });
  assert.ok(changes.some((c) => c.path === 'personnel.aero'), 'changes use the resolved department');

  engine.trigger(match, 'all_ops', { teamIds: [team.id] });
  assert.equal(team.flags.hits, 2, 'numeric flags count up');

  engine.trigger(match, 'ranged', { teamIds: [team.id] });
  const gained = team.eventLog.at(-1).changes.find((c) => c.path === 'budget');
  assert.ok(gained.to - gained.from >= 100 && gained.to - gained.from <= 200);
  assert.equal(team.personnel.business, 7);
});

test('effects: definitions are frozen and never mutated by outcomes', () => {
  const { engine, match, team } = setup({
    events: [ev({ ongoing: { label: 'L', rounds: 2, perRound: { budget: -1 } } })],
  });
  engine.trigger(match, 'e', { teamIds: [team.id] });
  team.activeEffects[0].perRound.budget = -999;
  assert.equal(engine.get('e').ongoing.perRound.budget, -1);
});

// ---- Ongoing effects ------------------------------------------------------------------------

test('ongoing: perRound runs each resolution, expires, and re-applying refreshes instead of stacking', () => {
  const { engine, match, team } = setup({
    events: [ev({ effects: undefined, ongoing: { label: 'Drain', rounds: 2, perRound: { budget: -1000 } } })],
  });
  engine.trigger(match, 'e', { teamIds: [team.id] });
  engine.trigger(match, 'e', { teamIds: [team.id] });
  assert.equal(team.activeEffects.length, 1);

  const drains = () => team.eventLog.filter((e) => e.kind === 'ongoing').length;
  playRound(match, engine);
  assert.equal(drains(), 1);
  playRound(match, engine);
  assert.equal(drains(), 2);
  assert.equal(team.activeEffects.length, 0);
  playRound(match, engine);
  assert.equal(drains(), 2, 'expired');
});

test('ongoing: modifiers scale production', () => {
  const { engine, match, team } = setup({
    events: [ev({ effects: undefined, ongoing: { label: 'No aero', rounds: 1, modifiers: { 'output.aero': 0, income: 2 } } })],
  });
  const before = projectProduction(team, match);
  engine.trigger(match, 'e', { teamIds: [team.id] });
  const after = projectProduction(team, match);
  assert.ok(after.gains.performance < before.gains.performance, 'no aero output');
  assert.equal(after.departments.aero.performance, 0);
  assert.ok(Math.abs(after.income - before.income * 2) <= 1, 'income doubled');

  playRound(match, engine);
  assert.equal(team.history.at(-1).income, after.income, 'the round produced what was projected');
});

// ---- Decisions --------------------------------------------------------------------------------

const decisionEvent = ev({
  id: 'choice',
  effects: undefined,
  decision: {
    prompt: 'Pick',
    options: [
      { id: 'pay', label: 'Pay', requires: { budget: { min: 5000 } }, effects: { budget: -5000 } },
      { id: 'secret', label: 'Secret', hideEffects: true, effects: { 'stats.performance': 10 } },
    ],
    onTimeout: { result: 'Too slow', effects: { 'stats.reliability': -10 } },
  },
});

test('decisions: answer is applied at the next resolution', () => {
  const { engine, match, team } = setup({ events: [decisionEvent] });
  const [{ decisionId }] = engine.trigger(match, 'choice', { teamIds: [team.id] });
  engine.answerDecision(match, team.id, decisionId, 'pay');
  assert.equal(team.budget, 10000, 'not applied yet');
  playRound(match, engine);
  const settled = team.eventLog.find((e) => e.kind === 'decision');
  assert.equal(settled.choice, 'pay');
  assert.equal(team.pendingDecisions.length, 0);
  assert.ok(settled.changes.some((c) => c.path === 'budget' && c.to - c.from === -5000));
});

test('decisions: requires is enforced when answering', () => {
  const { engine, match, team } = setup({ events: [decisionEvent] });
  team.budget = 100;
  const [{ decisionId }] = engine.trigger(match, 'choice', { teamIds: [team.id] });
  assert.throws(() => engine.answerDecision(match, team.id, decisionId, 'pay'), { code: 'option_unavailable' });
  const view = engine.decisionsView(match, team.id)[0];
  assert.equal(view.options[0].available, false);
  assert.match(view.options[0].unavailableReason, /budget ≥ 5000/);
});

test('decisions: unanswered decisions time out at their due round', () => {
  const { engine, match, team } = setup({ events: [decisionEvent] });
  engine.trigger(match, 'choice', { teamIds: [team.id] }); // during round 1 decision phase → due round 2
  playRound(match, engine);
  assert.equal(team.pendingDecisions.length, 1, 'still open for round 2');
  playRound(match, engine);
  const settled = team.eventLog.find((e) => e.kind === 'decision');
  assert.equal(settled.choice, 'timeout');
  assert.equal(settled.text, 'Too slow');
  assert.equal(team.pendingDecisions.length, 0);
});

test('decisions: answers are rejected outside the decision phase', () => {
  const { engine, match, team } = setup({ events: [decisionEvent] });
  const [{ decisionId }] = engine.trigger(match, 'choice', { teamIds: [team.id] });
  match.phase = 'resolution';
  assert.throws(() => engine.answerDecision(match, team.id, decisionId, 'secret'), { code: 'decisions_closed' });
});

test('hideEffects: decision-level toggle with per-option override', () => {
  const shown = setup({ events: [decisionEvent] });
  shown.engine.trigger(shown.match, 'choice', { teamIds: [shown.team.id] });
  const [pay, secret] = shown.engine.decisionsView(shown.match, shown.team.id)[0].options;
  assert.equal(pay.effectsHidden, false);
  assert.deepEqual(pay.preview.effects, [{ path: 'budget', op: 'add', value: -5000 }]);
  assert.equal(secret.effectsHidden, true, 'option override');
  assert.equal(secret.preview, null);

  const hiddenEvent = structuredClone(decisionEvent);
  hiddenEvent.decision.hideEffects = true;
  hiddenEvent.decision.options[1].hideEffects = false;
  const hidden = setup({ events: [hiddenEvent] });
  hidden.engine.trigger(hidden.match, 'choice', { teamIds: [hidden.team.id] });
  const view = hidden.engine.decisionsView(hidden.match, hidden.team.id)[0];
  assert.equal(view.options[0].preview, null);
  assert.notEqual(view.options[1].preview, null, 'option can un-hide itself');
  assert.equal(view.onTimeout.preview, null);
});

// ---- Follow-ups ---------------------------------------------------------------------------------

test('followUp: fires exactly inRounds later, ignoring weight, conditions and limits', () => {
  const { engine, match, team } = setup({
    events: [
      ev({ id: 'cause', followUp: { event: 'consequence', inRounds: 2 } }),
      ev({ id: 'consequence', weight: 0, enabled: false, maxPerTeam: 1, conditions: { round: 99 }, effects: { budget: -1 } }),
    ],
  });
  engine.trigger(match, 'cause', { teamIds: [team.id] }); // round 1 → fires at end of round 3
  assert.deepEqual(team.scheduledEvents, [{ eventId: 'consequence', round: 3, sourceEventId: 'cause' }]);

  const fired = () => team.eventLog.filter((e) => e.eventId === 'consequence');
  playRound(match, engine);
  playRound(match, engine);
  assert.equal(fired().length, 0);
  playRound(match, engine);
  assert.equal(fired().length, 1);
  assert.equal(fired()[0].round, 3);
  assert.equal(fired()[0].source, 'followUp');
  assert.equal(team.scheduledEvents.length, 0);
});

test('followUp: from a decision option is scheduled when the answer is settled', () => {
  const { engine, match, team } = setup({
    events: [
      ev({
        id: 'offer',
        effects: undefined,
        decision: {
          prompt: '?',
          options: [
            { id: 'yes', label: 'Yes', followUp: { event: 'later' } },
            { id: 'no', label: 'No' },
          ],
          onTimeout: { option: 'no' },
        },
      }),
      ev({ id: 'later', weight: 0 }),
    ],
  });
  const [{ decisionId }] = engine.trigger(match, 'offer', { teamIds: [team.id] });
  engine.answerDecision(match, team.id, decisionId, 'yes');
  playRound(match, engine); // settled in round 1 → follow-up at round 2
  assert.equal(team.scheduledEvents[0].round, 2);
  playRound(match, engine);
  assert.equal(team.eventLog.filter((e) => e.eventId === 'later').length, 1);
});

// ---- Random rolls & limits -----------------------------------------------------------------------

test('rolls: conditions, maxPerTeam, cooldown and pending-decision cap', () => {
  const always = { teamEventChance: 1, globalEventChance: 0 };
  const { engine, match, team } = setup({
    teams: 1,
    rolls: always,
    events: [
      ev({ id: 'once', weight: 1, maxPerTeam: 1 }),
      ev({ id: 'gated', weight: 1000, conditions: { budget: { min: 1_000_000 } } }),
    ],
  });
  for (let i = 0; i < 4; i++) playRound(match, engine);
  const fired = team.eventLog.filter((e) => e.kind === 'event').map((e) => e.eventId);
  assert.deepEqual(fired, ['once']);

  const cd = setup({ teams: 1, rolls: always, events: [ev({ id: 'cd', cooldownRounds: 2 })] });
  for (let i = 0; i < 7; i++) playRound(cd.match, cd.engine);
  assert.deepEqual(cd.team.eventLog.map((e) => e.round), [1, 4, 7]);

  const capped = setup({ teams: 1, rolls: always, events: [ev({ id: 'd', effects: undefined, decision: decisionEvent.decision })] });
  playRound(capped.match, capped.engine);
  assert.equal(capped.team.pendingDecisions.length, 1);
  assert.equal(capped.engine.explain(capped.match, 'd', capped.team.id).eligible, false);
});

test('rolls: global events hit only matching teams and respect maxPerMatch', () => {
  const { engine, match } = setup({
    teams: 3,
    rolls: { teamEventChance: 0, globalEventChance: 1 },
    events: [ev({ id: 'g', scope: 'global', maxPerMatch: 1, conditions: { 'flags.target': true }, effects: { budget: 1 } })],
  });
  match.teams[0].flags.target = true;
  match.teams[2].flags.target = true;
  playRound(match, engine);
  playRound(match, engine);
  assert.equal(match.eventHistory.length, 1);
  assert.deepEqual(match.eventHistory[0].teamIds, [match.teams[0].id, match.teams[2].id]);
});

test('determinism: same seed and inputs produce identical matches', () => {
  const run = () => {
    const engine = createEventEngine({ rolls: { teamEventChance: 1, globalEventChance: 0.5 } });
    const match = createMatch({ seed: 'repeat', totalRounds: 8 });
    for (let i = 0; i < 10; i++) addTeam(match);
    startMatch(match);
    while (match.status === 'running') playRound(match, engine);
    return JSON.stringify({ ...match, id: null });
  };
  assert.equal(run(), run());
});

// ---- Loading ------------------------------------------------------------------------------------------

test('loading: starter events.json is valid', () => {
  const engine = createEventEngine();
  assert.ok(engine.list().length > 0);
});

test('loading: invalid definitions throw with readable errors', () => {
  assert.throws(
    () => createEventEngine({ events: [ev({ weigth: 1 }), ev({ id: 'f', followUp: { event: 'missing' } })] }),
    (err) => err instanceof EventDefinitionError && err.errors.some((e) => e.includes('did you mean "weight"')),
  );
  assert.throws(
    () => createEventEngine({ events: [ev({ followUp: { event: 'missing' } })] }),
    (err) => err.errors.some((e) => e.includes('no event with id "missing"')),
  );
});

// ---- Public posts -------------------------------------------------------------------------------------

test('posts: outcomes publish rendered snippets to the public feed', () => {
  const { engine, match, team } = setup({
    events: [
      ev({
        id: 'deal',
        effects: { budget: [2400, 2400], 'personnel.@largest': -1 },
        post: '{team} ({location}, {country}) lands €{change.budget}, loses {change.personnel}',
      }),
      ev({
        id: 'offer',
        effects: undefined,
        decision: {
          prompt: '?',
          options: [
            { id: 'yes', label: 'Yes', effects: { budget: 500 }, post: '{team} says yes' },
            { id: 'no', label: 'No' },
          ],
          onTimeout: { result: 'Silence', post: '{team} went quiet' },
        },
      }),
    ],
  });
  engine.trigger(match, 'deal', { teamIds: [team.id] });
  assert.equal(match.feed.length, 1);
  assert.equal(match.feed[0].text, `${team.name} (${team.location.name}, ${team.location.country}) lands €2,400, loses 1`);
  assert.equal(match.feed[0].teamId, team.id);

  const [{ decisionId }] = engine.trigger(match, 'offer', { teamIds: [team.id] });
  assert.equal(match.feed.length, 1, 'a decision event without a post publishes nothing');
  engine.answerDecision(match, team.id, decisionId, 'yes');
  playRound(match, engine);
  assert.equal(match.feed.at(-1).text, `${team.name} says yes`);

  engine.trigger(match, 'offer', { teamIds: [team.id] });
  playRound(match, engine);
  playRound(match, engine);
  assert.equal(match.feed.at(-1).text, `${team.name} went quiet`, 'custom timeout outcome posts too');
});

test('posts: unknown placeholders are rejected, unchanged {change.x} warns', () => {
  assert.throws(
    () => createEventEngine({ events: [ev({ post: '{team} {budget}' })] }),
    (err) => err.errors.some((e) => e.includes('unknown placeholder {budget}')),
  );
  const engine = createEventEngine({ events: [ev({ post: '{team} +{change.stats.performance}' })] });
  assert.ok(engine.reload().warnings.some((w) => w.includes("don't change \"stats.performance\"")));
});
