// The end-of-season competition: a Formula Student event worth 1000 points.
//
// Everything is computed in one pass from the teams' final state, using the match's seeded RNG,
// so the same season always produces the same race. The result includes a `steps` timeline that
// the Game Master reveals one screen at a time (statics with a finals round, the dynamic events,
// endurance lap by lap, efficiency, then the totals).
//
// Discipline definitions, point values, target times and DNF reasons live in rules.js.

import { createRng } from './rng.js';
import { staffOutput } from './match.js';
import { DEPARTMENTS, RACE, RACE_TOTAL_POINTS, STATS } from './rules.js';

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
/** Symmetric random factor, e.g. jitter(rng, 0.01) → 0.99…1.01 */
const jitter = (rng, amount) => 1 + (rng.next() * 2 - 1) * amount;

/** Turn a team's final state into a 0–100 capability for one discipline. */
export function capability(team, weights) {
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    total += weight * capabilityValue(team, key);
  }
  return clamp(total, 0, 100);
}

function capabilityValue(team, key) {
  if (STATS.includes(key)) return team.stats[key] ?? 0;
  // Department output, with the same diminishing returns as during the season.
  if (DEPARTMENTS.includes(key)) return staffOutput(team.personnel[key] ?? 0);
  // Financial handling: how much of the starting budget is still there (debt counts as 0).
  if (key === 'budgetKept') return clamp(team.budget / Math.max(1, team.start?.budget ?? team.budget), 0, 1.5);
  if (key === 'incomePer10k') return team.history.reduce((sum, report) => sum + report.income, 0) / 10000;
  throw new Error(`Unknown capability key "${key}"`);
}

/**
 * Competition-day pace for one discipline: track, weather and wind move the winning time around the
 * typical one in the rules (3.2 s for acceleration, 74 s for an endurance lap, …), ±RACE.dayVariation.
 */
const dayPace = (rng) => jitter(rng, RACE.dayVariation);

/**
 * The time a car could do on this day: the best car in the field runs at the day's pace and
 * everyone else is behind in proportion to how far their capability is from the leader's. A team a
 * full 100 capability points behind lands on the cutoff, which is worth zero points.
 */
const potentialTime = (def, pace, cap, topCap) => def.bestTime * pace * (1 + RACE.spread * clamp((topCap - cap) / 100, 0, 1));

/** One run: a car only ever loses time against its potential (0…RACE.runVariation). */
function runTime(def, pace, cap, topCap, rng) {
  return round2(potentialTime(def, pace, cap, topCap) * (1 + rng.next() * RACE.runVariation));
}

/** Judged disciplines: the best team takes full points, everyone else is scaled to them. */
function scorePoints(rows, maxPoints, scoreOf) {
  const best = Math.max(...rows.map(scoreOf), 0);
  for (const row of rows) row.points = best > 0 ? round1(maxPoints * clamp(scoreOf(row) / best, 0, 1)) : 0;
}

/**
 * Timed disciplines: the fastest takes full points and a team `cutoff` times slower scores none
 * (the Formula Student curve). Cars without a time keep 0.
 */
function timePoints(rows, maxPoints) {
  const times = rows.filter((r) => r.time != null).map((r) => r.time);
  if (!times.length) return;
  const best = Math.min(...times);
  const cut = best * RACE.cutoff;
  for (const row of rows) {
    row.points = row.time == null ? 0 : round1(maxPoints * clamp((cut / row.time - 1) / (RACE.cutoff - 1), 0, 1));
  }
}

const byPoints = (a, b) => b.points - a.points || (a.time ?? Infinity) - (b.time ?? Infinity);

// ---- Disciplines ---------------------------------------------------------------------

function runStatic(def, teams, rng) {
  const rows = teams.map((team) => ({
    teamId: team.id,
    score: round1(capability(team, def.capability)),
    finalist: false,
  }));

  const ranked = [...rows].sort((a, b) => b.score - a.score);
  const finalists = ranked.slice(0, Math.min(RACE.finalists, ranked.length));
  for (const row of finalists) {
    row.finalist = true;
    // Presentation day: the finals can still move things around inside the top group.
    row.finalScore = round1(row.score * jitter(rng, RACE.finalsSwing));
  }
  for (const row of rows) row.finalScore ??= row.score;

  scorePoints(rows, def.points, (row) => row.finalScore);
  rows.sort(byPoints);
  return { rows, finalistIds: finalists.map((r) => r.teamId) };
}

function runTimed(def, teams, rng) {
  const entrants = teams.filter((team) => !def.driverless || team.autonomous);
  const caps = new Map(entrants.map((team) => [team.id, capability(team, def.capability)]));
  const topCap = Math.max(...caps.values(), 0);
  const pace = dayPace(rng);

  const rows = teams.map((team) => {
    if (!caps.has(team.id)) return { teamId: team.id, status: 'not-entered', time: null, points: 0 };
    const cap = caps.get(team.id);
    return {
      teamId: team.id,
      status: 'finished',
      capability: round1(cap),
      time: runTime(def, pace, cap, topCap, rng),
      points: 0,
    };
  });
  timePoints(rows, def.points);
  rows.sort(byPoints);
  return { rows };
}

/** 18 laps, with per-lap failure chances driven by reliability. Returns the laps for the reveal. */
function runEndurance(def, teams, rng) {
  const { laps, lapVariation, degradation, dnfBase, dnfDecay } = RACE.endurance;
  const caps = new Map(teams.map((team) => [team.id, capability(team, def.capability)]));
  const topCap = Math.max(...caps.values(), 0);
  const pace = dayPace(rng);
  const cars = teams.map((team) => ({
    teamId: team.id,
    team,
    baseLap: potentialTime(def, pace, caps.get(team.id), topCap),
    reliability: team.stats.reliability,
    status: 'running',
    laps: 0,
    total: 0,
    lastLap: null,
    bestLap: null,
  }));
  /** The race's fastest lap so far: { teamId, time, lap } */
  let fastestLap = null;

  const lapSteps = [];
  for (let lap = 1; lap <= laps; lap++) {
    const retirements = [];
    for (const car of cars) {
      if (car.status !== 'running') continue;
      const failureChance = dnfBase * Math.exp(-dnfDecay * car.reliability);
      if (rng.next() < failureChance) {
        car.status = 'dnf';
        car.dnfLap = lap;
        car.reason = pickReason(car.team, rng);
        retirements.push({ teamId: car.teamId, lap, reason: car.reason });
        continue;
      }
      const wear = 1 + (1 - car.reliability / 100) * degradation * (lap - 1);
      const lapTime = round2(car.baseLap * wear * jitter(rng, lapVariation));
      car.laps = lap;
      car.total = round2(car.total + lapTime);
      car.lastLap = lapTime;
      car.bestLap = car.bestLap == null ? lapTime : Math.min(car.bestLap, lapTime);
      if (!fastestLap || lapTime < fastestLap.time) fastestLap = { teamId: car.teamId, time: lapTime, lap };
    }
    lapSteps.push({ lap, retirements, order: leaderboard(cars), fastestLap: fastestLap && { ...fastestLap } });
  }

  const rows = cars.map((car) => ({
    teamId: car.teamId,
    status: car.status === 'running' ? 'finished' : 'dnf',
    laps: car.laps,
    time: car.status === 'running' ? round2(car.total) : null,
    bestLap: car.bestLap,
    dnfLap: car.dnfLap ?? null,
    reason: car.reason ?? null,
    points: 0,
  }));
  timePoints(rows, def.points);
  rows.sort(byPoints);
  return { rows, lapSteps, fastestLap };
}

/** Efficiency is scored from the endurance run, so only finishers get a figure. */
function runEfficiency(def, teams, rng, enduranceRows) {
  const finished = new Set(enduranceRows.filter((r) => r.status === 'finished').map((r) => r.teamId));
  const caps = new Map(teams.filter((t) => finished.has(t.id)).map((team) => [team.id, capability(team, def.capability)]));
  const topCap = Math.max(...caps.values(), 0);
  const pace = dayPace(rng);

  const rows = teams.map((team) => {
    if (!finished.has(team.id)) return { teamId: team.id, status: 'no-time', time: null, points: 0 };
    const cap = caps.get(team.id);
    return {
      teamId: team.id,
      status: 'finished',
      capability: round1(cap),
      time: runTime(def, pace, cap, topCap, rng),
      points: 0,
    };
  });
  timePoints(rows, def.points);
  rows.sort(byPoints);
  return { rows };
}

/**
 * The live timing board after a lap: running cars by total time, retired cars after them (most laps
 * first). `gap` is seconds behind the leader, null for retired cars.
 */
function leaderboard(cars) {
  const sorted = [...cars].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'running' ? -1 : 1;
    if (b.laps !== a.laps) return b.laps - a.laps;
    return a.total - b.total;
  });
  const leader = sorted.find((car) => car.status === 'running');
  return sorted.map((car) => ({
    teamId: car.teamId,
    status: car.status,
    laps: car.laps,
    total: round2(car.total),
    gap: car.status === 'running' && leader ? round2(car.total - leader.total) : null,
    lastLap: car.lastLap,
    bestLap: car.bestLap,
  }));
}

/** A failure is likelier where the team is thin on staff; the driver can always have a moment. */
function pickReason(team, rng) {
  const weighted = RACE.endurance.dnfReasons.map((reason) => ({
    reason,
    weight: reason.department ? 1 / (1 + staffOutput(team.personnel[reason.department] ?? 0)) : 0.25,
  }));
  return (rng.weighted(weighted, (w) => w.weight) ?? weighted[0]).reason.text;
}

// ---- The show -------------------------------------------------------------------------

/**
 * Run the whole competition for a finished match.
 * @returns {import('./model.js').Race}
 */
export function computeRace(match) {
  const rng = createRng(match);
  const teams = match.teams;
  const results = {};
  const steps = [{ kind: 'intro', title: 'Competition day', subtitle: `${teams.length} teams · ${RACE_TOTAL_POINTS} points on offer` }];

  for (const def of RACE.disciplines) {
    if (def.type === 'static') {
      const result = runStatic(def, teams, rng);
      results[def.id] = result;
      const finalists = new Set(result.finalistIds);
      steps.push({
        kind: 'static-preliminary',
        disciplineId: def.id,
        title: def.name,
        subtitle: `${def.points} points · ${def.blurb}`,
        rows: result.rows.filter((r) => !finalists.has(r.teamId)),
        finalistIds: result.finalistIds,
      });
      steps.push({
        kind: 'static-finals',
        disciplineId: def.id,
        title: `${def.name} — finals`,
        subtitle: `Top ${result.finalistIds.length} presented again to the judges`,
        rows: result.rows.filter((r) => finalists.has(r.teamId)),
        standings: result.rows,
      });
    } else if (def.type === 'timed') {
      const result = runTimed(def, teams, rng);
      results[def.id] = result;
      steps.push({
        kind: 'timed',
        disciplineId: def.id,
        title: def.name,
        subtitle: `${def.points} points · ${def.blurb}`,
        rows: result.rows,
      });
    } else if (def.type === 'endurance') {
      const result = runEndurance(def, teams, rng);
      results[def.id] = result;
      for (const lap of result.lapSteps) {
        steps.push({
          kind: 'endurance-lap',
          disciplineId: def.id,
          title: `Endurance — lap ${lap.lap}/${RACE.endurance.laps}`,
          subtitle: lap.retirements.length ? 'We have a retirement.' : `${def.points} points · ${def.blurb}`,
          lap: lap.lap,
          totalLaps: RACE.endurance.laps,
          order: lap.order,
          retirements: lap.retirements,
          fastestLap: lap.fastestLap,
        });
      }
      steps.push({
        kind: 'endurance-result',
        disciplineId: def.id,
        title: 'Endurance — result',
        subtitle: `${result.rows.filter((r) => r.status === 'finished').length} of ${teams.length} cars finished`,
        rows: result.rows,
        fastestLap: result.fastestLap,
      });
    } else if (def.type === 'efficiency') {
      const result = runEfficiency(def, teams, rng, results.endurance?.rows ?? []);
      results[def.id] = result;
      steps.push({
        kind: 'efficiency',
        disciplineId: def.id,
        title: def.name,
        subtitle: `${def.points} points · ${def.blurb}`,
        rows: result.rows,
      });
    }
  }

  const totals = teams
    .map((team) => {
      const byDiscipline = {};
      let total = 0;
      for (const def of RACE.disciplines) {
        const points = results[def.id].rows.find((r) => r.teamId === team.id)?.points ?? 0;
        byDiscipline[def.id] = points;
        total += points;
      }
      return { teamId: team.id, total: round1(total), byDiscipline };
    })
    .sort((a, b) => b.total - a.total)
    .map((row, i) => ({ place: i + 1, ...row }));

  steps.push({
    kind: 'totals',
    title: 'Overall standings',
    subtitle: `Out of ${RACE_TOTAL_POINTS} points`,
    rows: totals,
  });
  steps.push({
    kind: 'podium',
    title: 'And the winner is…',
    subtitle: 'Congratulations!',
    rows: totals.slice(0, 3),
  });

  return {
    status: 'revealing',
    step: 0,
    disciplines: RACE.disciplines.map(({ id, name, type, points, unit, blurb }) => ({ id, name, type, points, unit: unit ?? null, blurb })),
    results,
    steps,
    totals,
  };
}
