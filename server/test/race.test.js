import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRace, capability } from '../src/game/race.js';
import { RACE, RACE_TOTAL_POINTS, AUTONOMOUS } from '../src/game/rules.js';
import { addTeam, createMatch, endMatch, setAllocation, setAutonomous, startMatch, projectProduction } from '../src/game/match.js';

/** A finished season with teams of very different strength. */
function season({ seed = 'race', teams = 4, autonomousIds = [] } = {}) {
  const match = createMatch({ seed, totalRounds: 1 });
  for (let i = 0; i < teams; i++) addTeam(match, { name: `Team ${i + 1}` });
  match.teams.forEach((team, i) => {
    const strength = i / Math.max(1, teams - 1); // 0 = weakest, 1 = strongest
    team.stats = {
      performance: Math.round(20 + 60 * strength),
      reliability: Math.round(20 + 70 * strength),
      autonomy: autonomousIds.includes(team.id) ? Math.round(30 + 60 * strength) : 0,
    };
    team.autonomous = autonomousIds.includes(team.id);
    team.personnel = { aero: 6 + 5 * i, chassis: 6 + 5 * i, powertrain: 6 + 3 * i, electronics: 5 + 3 * i, business: 5 + 2 * i, driverless: team.autonomous ? 6 + 2 * i : 0 };
    team.start = { budget: 150000, stats: { ...team.stats } };
    team.budget = 40000 + i * 40000;
    team.history = [{ round: 1, income: 30000 + i * 5000, upkeep: 40000, gains: {}, stats: team.stats, budget: team.budget, score: 0 }];
  });
  startMatch(match);
  endMatch(match);
  return match;
}

const rowFor = (race, disciplineId, teamId) => race.results[disciplineId].rows.find((r) => r.teamId === teamId);

test('the whole competition is worth 1000 points and the winner takes the most', () => {
  const match = season({ autonomousIds: ['t2', 't4'] });
  const race = computeRace(match);

  assert.equal(RACE_TOTAL_POINTS, 1000);
  assert.equal(race.disciplines.length, 10);
  assert.equal(race.totals.length, match.teams.length);
  assert.equal(race.totals[0].place, 1);
  assert.ok(race.totals[0].total > race.totals.at(-1).total, 'the stronger team wins');
  assert.ok(race.totals[0].total <= RACE_TOTAL_POINTS);

  // Each discipline's best team takes its full points.
  for (const def of RACE.disciplines) {
    const best = Math.max(...race.results[def.id].rows.map((r) => r.points));
    assert.equal(best, def.points, `${def.id} awards its maximum`);
  }
  // Totals really are the sum of the per-discipline points.
  for (const row of race.totals) {
    const sum = Object.values(row.byDiscipline).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - row.total) < 0.11, 'totals add up');
  }
});

test('timed disciplines are won close to the typical time, and nobody is far beyond the cutoff', () => {
  const match = season({ autonomousIds: ['t1', 't2', 't3', 't4'] });
  const race = computeRace(match);

  for (const def of RACE.disciplines.filter((d) => d.type === 'timed')) {
    const times = race.results[def.id].rows.filter((r) => r.time != null).map((r) => r.time);
    const best = Math.min(...times);
    // The day's pace moves the winning time ±dayVariation, and a run can only lose time on top.
    const fastest = def.bestTime * (1 - RACE.dayVariation) - 0.01;
    const slowest = def.bestTime * (1 + RACE.dayVariation) * (1 + RACE.runVariation) + 0.01;
    assert.ok(best >= fastest && best <= slowest, `${def.id}: winning time ${best} should be within ${fastest.toFixed(2)}–${slowest.toFixed(2)}`);
    assert.ok(Math.max(...times) <= best * RACE.cutoff * (1 + RACE.runVariation), `${def.id}: nobody far slower than the cutoff`);
  }

  // Points fall off with the gap: the leader takes the maximum, the slowest takes the least.
  const acc = race.results.acceleration.rows;
  assert.equal(acc[0].points, 50);
  assert.ok(acc.at(-1).points < acc[0].points);
  assert.ok(acc.every((r) => r.points >= 0));
});

test('driverless disciplines only score for teams running the programme', () => {
  const match = season({ autonomousIds: ['t2', 't4'] });
  const race = computeRace(match);

  for (const id of ['acceleration_dv', 'skidpad_dv']) {
    for (const team of match.teams) {
      const row = rowFor(race, id, team.id);
      if (team.autonomous) {
        assert.equal(row.status, 'finished');
        assert.ok(row.time > 0);
      } else {
        assert.equal(row.status, 'not-entered');
        assert.equal(row.points, 0);
        assert.equal(row.time, null);
      }
    }
  }
  // 150 points are simply out of reach without the programme.
  const without = race.totals.find((r) => r.teamId === 't3');
  assert.equal(without.byDiscipline.acceleration_dv + without.byDiscipline.skidpad_dv, 0);
});

test('statics run a finals round for the top four', () => {
  const match = season({ teams: 6 });
  const race = computeRace(match);
  const design = race.results.design;

  assert.equal(design.finalistIds.length, RACE.finalists);
  const finalists = design.rows.filter((r) => r.finalist);
  assert.equal(finalists.length, RACE.finalists);
  // Reveal order: everyone else first, then the finals.
  const prelim = race.steps.find((s) => s.kind === 'static-preliminary' && s.disciplineId === 'design');
  const finals = race.steps.find((s) => s.kind === 'static-finals' && s.disciplineId === 'design');
  assert.equal(prelim.rows.length, match.teams.length - RACE.finalists);
  assert.ok(prelim.rows.every((r) => !r.finalist));
  assert.equal(finals.rows.length, RACE.finalists);
  assert.equal(finals.standings.length, match.teams.length);
});

test('endurance runs lap by lap; fragile cars retire and reliable ones mostly finish', () => {
  // The failure rolls are random, so check the shape over a set of seeds rather than one.
  let fragileRetired = 0;
  let solidRetired = 0;
  let checkedAnnouncement = false;

  const seasons = 40;
  for (let i = 0; i < seasons; i++) {
    const match = season({ teams: 3, seed: `endurance-${i}` });
    match.teams[0].stats.reliability = 0; // this car is held together with tape
    match.teams[2].stats.reliability = 95;
    const race = computeRace(match);

    const laps = race.steps.filter((s) => s.kind === 'endurance-lap');
    assert.equal(laps.length, RACE.endurance.laps);
    assert.equal(laps.at(-1).lap, RACE.endurance.laps);

    const fragile = rowFor(race, 'endurance', match.teams[0].id);
    const solid = rowFor(race, 'endurance', match.teams[2].id);
    if (fragile.status === 'dnf') fragileRetired++;
    if (solid.status === 'dnf') solidRetired++;

    if (fragile.status === 'dnf' && !checkedAnnouncement) {
      checkedAnnouncement = true;
      assert.ok(fragile.dnfLap >= 1 && fragile.dnfLap <= RACE.endurance.laps);
      assert.ok(RACE.endurance.dnfReasons.some((r) => r.text === fragile.reason), 'the reason comes from the rules');
      assert.equal(fragile.points, 0);
      assert.equal(fragile.laps, fragile.dnfLap - 1, 'the retirement lap is not counted');
      // The retirement is announced on the lap it happens.
      const announced = laps.flatMap((s) => s.retirements).find((r) => r.teamId === match.teams[0].id);
      assert.equal(announced.lap, fragile.dnfLap);
      assert.equal(announced.reason, fragile.reason);
      // No endurance finish, no efficiency score.
      assert.equal(rowFor(race, 'efficiency', match.teams[0].id).status, 'no-time');
      const finisher = race.results.endurance.rows.find((r) => r.status === 'finished');
      assert.equal(rowFor(race, 'efficiency', finisher.teamId).status, 'finished');
      assert.equal(finisher.laps, RACE.endurance.laps);
    }
  }

  assert.ok(checkedAnnouncement, 'the fragile car retired at least once');
  // Expected ≈ 85% and ≈ 1.3% with the rules' curve; the bounds leave room for chance.
  assert.ok(fragileRetired >= seasons * 0.65, `a car with no reliability should usually retire (${fragileRetired}/${seasons})`);
  assert.ok(solidRetired <= seasons * 0.1, `a reliable car should usually finish (${solidRetired}/${seasons} retired)`);
});

test('winning times change from one competition to the next', () => {
  const winning = (disciplineId, rows, key = 'time') => Math.min(...rows.filter((r) => r[key] != null).map((r) => r[key]));
  const seen = { acceleration: new Set(), skidpad: new Set(), autocross: new Set(), endurance: new Set(), efficiency: new Set() };
  for (let i = 0; i < 12; i++) {
    const race = computeRace(season({ seed: `pace-${i}` }));
    for (const id of ['acceleration', 'skidpad', 'autocross', 'efficiency']) seen[id].add(winning(id, race.results[id].rows));
    seen.endurance.add(winning('endurance', race.results.endurance.rows, 'bestLap'));
  }
  for (const [id, times] of Object.entries(seen)) {
    const def = RACE.disciplines.find((d) => d.id === id);
    assert.ok(times.size >= 8, `${id}: winning times should vary, got ${[...times].join(', ')}`);
    assert.ok([...times].some((t) => t < def.bestTime) && [...times].some((t) => t > def.bestTime), `${id}: sometimes faster, sometimes slower than ${def.bestTime}`);
  }
});

test('the endurance timing board shows total time, gap, last lap and best lap', () => {
  const race = computeRace(season({ teams: 4, seed: 'timing' }));
  const laps = race.steps.filter((s) => s.kind === 'endurance-lap');
  let fastestSoFar = Infinity;

  for (const step of laps) {
    const running = step.order.filter((car) => car.status === 'running');
    if (running.length) assert.equal(running[0].gap, 0, 'the leader has no gap');
    for (let i = 1; i < running.length; i++) {
      assert.ok(running[i].total >= running[i - 1].total, 'running cars are ordered by total time');
      assert.ok(Math.abs(running[i].gap - (running[i].total - running[0].total)) < 0.011);
    }
    for (const car of step.order) {
      if (car.laps === 0) continue;
      assert.ok(car.bestLap <= car.lastLap, 'the best lap is never slower than the last one');
      if (car.status === 'running') assert.equal(car.laps, step.lap);
      else assert.equal(car.gap, null);
    }
    // The fastest lap of the race so far belongs to a car whose best lap it is.
    const bests = step.order.filter((car) => car.bestLap != null).map((car) => car.bestLap);
    if (bests.length) {
      assert.equal(step.fastestLap.time, Math.min(...bests));
      assert.ok(step.fastestLap.time <= fastestSoFar);
      assert.ok(step.fastestLap.lap <= step.lap);
      fastestSoFar = step.fastestLap.time;
    }
  }

  // The total is the sum of the laps: 18 laps at roughly the lap time.
  const winner = race.results.endurance.rows.find((r) => r.status === 'finished');
  if (winner) assert.ok(winner.time > winner.bestLap * RACE.endurance.laps * 0.99);
  assert.deepEqual(race.steps.find((s) => s.kind === 'endurance-result').fastestLap, laps.at(-1).fastestLap);
});

test('the same season always produces the same race', () => {
  const run = () => JSON.stringify(computeRace(season({ seed: 'repeatable' })));
  assert.equal(run(), run());
});

test('the reveal timeline covers every discipline and ends on the podium', () => {
  const race = computeRace(season());
  assert.equal(race.steps[0].kind, 'intro');
  assert.equal(race.steps.at(-1).kind, 'podium');
  assert.equal(race.steps.at(-2).kind, 'totals');
  for (const def of RACE.disciplines) {
    assert.ok(race.steps.some((s) => s.disciplineId === def.id), `${def.id} is announced`);
  }
  assert.equal(race.status, 'revealing');
  assert.equal(race.step, 0);
});

// ---- The driverless programme during the season -------------------------------------------

test('the programme costs money, unlocks its department and grows autonomy', () => {
  const match = createMatch({ seed: 'dv', totalRounds: 14 });
  const team = addTeam(match, { name: 'DV' });
  team.budget = 100000;
  const staff = { ...team.personnel };

  assert.throws(() => setAllocation(match, team.id, { ...staff, driverless: 1, aero: staff.aero - 1 }), { code: 'needs_autonomous' });
  assert.equal(projectProduction(team, match).gains.autonomy, 0);
  const baseline = projectProduction(team, match);

  setAutonomous(match, team.id, true);
  assert.equal(team.autonomous, true);
  assert.equal(team.budget, 100000 - AUTONOMOUS.setupCost);
  assert.equal(team.eventLog.at(-1).kind, 'programme');

  // Running it costs money every round (× the location's cost level) but sponsors pay more attention.
  const running = projectProduction(team, match);
  assert.equal(running.upkeep - baseline.upkeep, Math.round(AUTONOMOUS.perRoundCost * team.location.costLevel));
  assert.ok(Math.abs(baseline.programmeCost - (running.upkeep - baseline.upkeep)) <= 1, 'the cost shown before starting is what it costs');
  assert.ok(running.income > baseline.income, 'industry interest pays');

  setAllocation(match, team.id, { ...staff, driverless: 2, aero: staff.aero - 1, chassis: staff.chassis - 1 });
  assert.ok(projectProduction(team, match).gains.autonomy > 0, 'autonomy grows once the programme runs and is staffed');

  assert.throws(() => setAutonomous(match, team.id, false), { code: 'driverless_staffed' });
  setAllocation(match, team.id, { ...staff, driverless: 0 });
  setAutonomous(match, team.id, false);
  assert.equal(team.autonomous, false);
  assert.equal(projectProduction(team, match).gains.autonomy, 0);
});

test('a team that cannot pay the setup fee cannot start the programme', () => {
  const match = createMatch({ seed: 'poor', totalRounds: 3 });
  const team = addTeam(match, { name: 'Broke' });
  team.budget = AUTONOMOUS.setupCost - 1;
  assert.throws(() => setAutonomous(match, team.id, true), { code: 'cannot_afford' });
  assert.equal(team.autonomous, false);
});
