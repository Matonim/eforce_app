import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventEngine } from '../src/events/engine.js';
import { addTeam, createMatch, projectProduction, resolveRound, setAllocation, setFocus, startMatch } from '../src/game/match.js';
import { DEPARTMENTS } from '../src/game/rules.js';
import { teamView } from '../src/net/views.js';

const engine = createEventEngine({
  events: [{ id: 'e', title: 'E', text: 'e', weight: 1, effects: { budget: 1 } }],
  rolls: { teamEventChance: 0, globalEventChance: 0 },
});

function setup() {
  const match = createMatch({ seed: 'views' });
  const team = addTeam(match, { name: 'Alpha' });
  addTeam(match, { name: 'Beta' });
  return { match, team };
}

test('team view: projection equals the resolved round, rules and starting values are included', () => {
  const { match, team } = setup();
  const total = Object.values(team.personnel).reduce((a, b) => a + b, 0);
  const share = (f) => Math.floor(total * f);
  const staff = { aero: share(0.25), chassis: share(0.2), powertrain: share(0.2), electronics: share(0.15), driverless: 0 };
  staff.business = total - Object.values(staff).reduce((a, b) => a + b, 0);
  setAllocation(match, team.id, staff);
  setFocus(match, team.id, 70);
  startMatch(match);

  const before = teamView(match, engine, team.id);
  const expected = projectProduction(team, match);
  assert.deepEqual(before.me.projection, {
    gains: expected.gains,
    income: expected.income,
    upkeep: expected.upkeep,
    net: expected.net,
    departments: expected.departments,
    programmeCost: expected.programmeCost,
  });

  resolveRound(match, engine.hooks);
  const report = team.history.at(-1);
  assert.deepEqual(report.gains, before.me.projection.gains);
  assert.equal(report.income, before.me.projection.income);
  assert.equal(report.upkeep, before.me.projection.upkeep);
  assert.equal(team.budget - before.me.budget, before.me.projection.net);

  assert.deepEqual(before.rules.departments.map((d) => d.id), DEPARTMENTS);
  assert.ok(before.rules.departments.every((d) => d.label));
  // Each department's breakdown adds up to the forecast, and one more person always adds something.
  const sum = (stat) => Object.values(before.me.projection.departments).reduce((a, d) => a + d[stat], 0);
  assert.ok(Math.abs(sum('performance') - before.me.projection.gains.performance) < 0.2);
  assert.ok(before.me.projection.departments.aero.nextPerson.performance > 0);
  assert.ok(before.me.projection.departments.business.nextPerson.sponsorship > 0);
  assert.ok(before.me.projection.departments.aero.nextPerson.cost > 0);
  assert.equal(before.me.start.budget, before.me.budget, 'nothing has happened yet');
  assert.equal(before.me.start.score, before.me.score);
});

test('team view: the season score stays hidden, even after the season ends', () => {
  const { match, team } = setup();
  startMatch(match);
  resolveRound(match, engine.hooks);

  const hidden = teamView(match, engine, team.id, { showOwnScore: false });
  assert.equal(hidden.me.score, null);
  assert.equal(hidden.me.start.score, null);
  assert.ok(hidden.me.history.every((h) => h.score === null));
  assert.doesNotMatch(JSON.stringify(hidden.me), /"score":-?\d/, 'no score values anywhere in the team payload');

  match.status = 'ended';
  const ended = teamView(match, engine, team.id);
  assert.equal(ended.me.score, null, 'hidden by default');
  assert.equal(ended.standings, null, 'no season standings for teams');

  const shown = teamView(match, engine, team.id, { showOwnScore: true });
  assert.equal(typeof shown.me.score, 'number');
  assert.equal(typeof shown.me.history[0].score, 'number');
});
