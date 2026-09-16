// Balance tool for the end-of-season competition.
//
//   npm run sim:race                      10 teams, 14 rounds, 50 seasons
//   npm run sim:race -- --matches=200 --teams=12 --rounds=10 --autonomy=0.5
//   npm run sim:race -- --show            print one full season's race, discipline by discipline
//
// Fake teams play a season (random staffing, focus and decisions; some run a driverless
// programme), then the competition is run and the results are aggregated.

import { createRng, hashSeed } from '../src/game/rng.js';
import { AUTONOMOUS, DEPARTMENTS, MATCH_DEFAULTS, RACE, RACE_TOTAL_POINTS } from '../src/game/rules.js';
import {
  addTeam,
  advanceRound,
  createMatch,
  endMatch,
  headcount,
  resolveRound,
  setAllocation,
  setAutonomous,
  setFocus,
  startMatch,
} from '../src/game/match.js';
import { computeRace } from '../src/game/race.js';
import { createEventEngine } from '../src/events/engine.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const seed = String(args.seed ?? 'workshop');
const teamCount = Number(args.teams ?? 10);
const rounds = Number(args.rounds ?? MATCH_DEFAULTS.totalRounds);
const matches = Number(args.matches ?? 50);
const autonomyShare = Number(args.autonomy ?? 0.4);

const engine = createEventEngine();
const round1 = (n) => Math.round(n * 10) / 10;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/** One season of fake decisions, then the competition. */
function playSeason(matchSeed) {
  const match = createMatch({ seed: matchSeed, totalRounds: rounds });
  for (let i = 0; i < teamCount; i++) addTeam(match);
  const players = createRng({ rngState: hashSeed(`players:${matchSeed}`) });
  startMatch(match);

  for (const team of match.teams) {
    // Some teams commit to a driverless programme in round 1.
    if (players.chance(autonomyShare) && team.budget > AUTONOMOUS.setupCost * 2) setAutonomous(match, team.id, true);
    setFocus(match, team.id, players.int(20, 85));
  }

  while (match.status === 'running') {
    for (const team of match.teams) {
      if (players.chance(0.6)) {
        const personnel = Object.fromEntries(DEPARTMENTS.map((d) => [d, 0]));
        const pool = team.autonomous ? DEPARTMENTS : DEPARTMENTS.filter((d) => d !== 'driverless');
        for (let i = 0; i < headcount(team); i++) personnel[players.pick(pool)]++;
        setAllocation(match, team.id, personnel);
      }
      if (players.chance(0.3)) setFocus(match, team.id, players.int(20, 85));
      for (const decision of engine.decisionsView(match, team.id)) {
        const available = decision.options.filter((o) => o.available);
        if (available.length && players.chance(0.75)) {
          engine.answerDecision(match, team.id, decision.instanceId, players.pick(available).id);
        }
      }
    }
    resolveRound(match, engine.hooks);
    advanceRound(match);
  }
  endMatch(match);
  return { match, race: computeRace(match) };
}

if (args.show) {
  const { match, race } = playSeason(seed);
  const name = (id) => match.teams.find((t) => t.id === id).name;
  console.log(bold(`\nSeason "${seed}": ${teamCount} teams, ${rounds} rounds`));
  for (const team of match.teams) {
    console.log(
      `  ${team.name.padEnd(20)} perf ${String(team.stats.performance).padStart(5)} · rel ${String(team.stats.reliability).padStart(5)}` +
        ` · autonomy ${String(team.stats.autonomy).padStart(5)} · €${team.budget.toLocaleString('en-US').padStart(8)}${team.autonomous ? ' · 🤖' : ''}`,
    );
  }
  for (const def of race.disciplines) {
    console.log(bold(`\n${def.name}`), dim(`(${def.points} pts)`));
    for (const row of race.results[def.id].rows.slice(0, 5)) {
      const figure =
        row.status === 'dnf'
          ? `DNF lap ${row.dnfLap} — ${row.reason}`
          : row.time != null
            ? `${row.time} ${def.unit}`
            : row.status === 'not-entered'
              ? 'no driverless car'
              : row.score != null
                ? `score ${row.score}`
                : '';
      console.log(`  ${String(row.points).padStart(6)} pts  ${name(row.teamId).padEnd(20)} ${figure}`);
    }
  }
  console.log(bold('\nOverall'));
  for (const row of race.totals) console.log(`  ${String(row.place).padStart(2)}. ${name(row.teamId).padEnd(20)} ${row.total} / ${RACE_TOTAL_POINTS}`);
  process.exit(0);
}

// ---- Aggregate over many seasons ---------------------------------------------------------

const perDiscipline = new Map(RACE.disciplines.map((d) => [d.id, { points: [], best: [] }]));
const winners = { autonomous: 0, total: 0, margins: [], totals: [] };
let starts = 0;
let dnfs = 0;
let autonomousTeams = 0;

for (let i = 0; i < matches; i++) {
  const { match, race } = playSeason(`${seed}-${i}`);
  const autonomous = new Set(match.teams.filter((t) => t.autonomous).map((t) => t.id));
  autonomousTeams += autonomous.size;

  for (const def of RACE.disciplines) {
    const rows = race.results[def.id].rows;
    const stat = perDiscipline.get(def.id);
    for (const row of rows) stat.points.push(row.points);
    // Endurance targets a lap time, not the 18-lap total.
    const times = def.type === 'endurance'
      ? rows.filter((r) => r.bestLap != null).map((r) => r.bestLap)
      : rows.filter((r) => r.time != null).map((r) => r.time);
    if (times.length) stat.best.push(Math.min(...times));
  }

  for (const row of race.results.endurance.rows) {
    starts++;
    if (row.status === 'dnf') dnfs++;
  }

  winners.total++;
  if (autonomous.has(race.totals[0].teamId)) winners.autonomous++;
  winners.totals.push(race.totals[0].total);
  if (race.totals.length > 1) winners.margins.push(round1(race.totals[0].total - race.totals[1].total));
}

const mean = (list) => (list.length ? round1(list.reduce((a, b) => a + b, 0) / list.length) : 0);

console.log(bold(`\n${matches} seasons · ${teamCount} teams · ${rounds} rounds · ${Math.round(autonomyShare * 100)}% aim for driverless`));
console.table(
  RACE.disciplines.map((def) => {
    const stat = perDiscipline.get(def.id);
    return {
      discipline: def.name,
      max: def.points,
      'avg points': mean(stat.points),
      'avg share': `${Math.round((mean(stat.points) / def.points) * 100)}%`,
      'winning (avg)': stat.best.length ? `${mean(stat.best)} ${def.unit}${def.type === 'endurance' ? ' lap' : ''}` : '—',
      'winning (range)': stat.best.length ? `${Math.min(...stat.best)}–${Math.max(...stat.best)}` : '—',
      typical: def.bestTime ? `${def.bestTime} ${def.unit}` : '—',
    };
  }),
);
console.log(`Endurance retirements: ${Math.round((dnfs / starts) * 100)}% of cars`);
console.log(`Driverless programmes: ${round1(autonomousTeams / matches)} teams per season · they win ${Math.round((winners.autonomous / winners.total) * 100)}% of seasons`);
console.log(`Winning total: mean ${mean(winners.totals)} / ${RACE_TOTAL_POINTS} · mean margin ${mean(winners.margins)} points\n`);
