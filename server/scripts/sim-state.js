// Step 2 smoke test: build a match in memory, let 10 fake teams make random decisions,
// resolve every round, and check that the same seed reproduces the same match.
//
//   npm run sim:state                  (seed "workshop")
//   npm run sim:state -- --seed=abc --rounds=10 --teams=8 --quiet

import { createRng, hashSeed } from '../src/game/rng.js';
import { DEPARTMENTS, MATCH_DEFAULTS } from '../src/game/rules.js';
import {
  addTeam,
  advanceRound,
  createMatch,
  headcount,
  resolveRound,
  setAllocation,
  setFocus,
  startMatch,
} from '../src/game/match.js';
import { computeScore } from '../src/game/rules.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const seed = args.seed ?? 'workshop';
const teamCount = Number(args.teams ?? 10);
const rounds = Number(args.rounds ?? MATCH_DEFAULTS.totalRounds);
const quiet = Boolean(args.quiet);

function randomAllocation(rng, team) {
  // Departments a team can actually staff: driverless needs the programme, which this script skips.
  const pool = DEPARTMENTS.filter((d) => d !== 'driverless' || team.autonomous);
  const personnel = Object.fromEntries(DEPARTMENTS.map((d) => [d, 0]));
  for (let i = 0; i < headcount(team); i++) personnel[rng.pick(pool)]++;
  return personnel;
}

function playRounds(match, fromRound, toRound, log) {
  // Player inputs come from their own RNG so they never disturb the match RNG.
  const players = { rngState: hashSeed(`players:${seed}:${fromRound}`) };
  const rng = createRng(players);
  for (let r = fromRound; r <= toRound && match.status === 'running'; r++) {
    for (const team of match.teams) {
      if (rng.chance(0.7)) setAllocation(match, team.id, randomAllocation(rng, team));
      if (rng.chance(0.7)) setFocus(match, team.id, rng.int(0, 100));
    }
    resolveRound(match);
    if (log) printRound(match);
    advanceRound(match);
  }
}

function runMatch(log) {
  const match = createMatch({ seed, totalRounds: rounds });
  for (let i = 0; i < teamCount; i++) addTeam(match);
  if (log) printTeams(match);
  startMatch(match);
  playRounds(match, 1, rounds, log);
  return match;
}

function printTeams(match) {
  console.log(`\nMatch ${match.id} · seed "${seed}" · ${match.teams.length} teams\n`);
  console.table(
    match.teams.map((t) => ({
      id: t.id,
      name: t.name,
      country: t.location.country,
      budget: t.budget,
      people: headcount(t),
      ...t.personnel,
      perf: t.stats.performance,
      rel: t.stats.reliability,
    })),
  );
}

function printRound(match) {
  console.log(`\nRound ${match.round}`);
  console.table(
    match.teams.map((t) => {
      const h = t.history.at(-1);
      return {
        name: t.name,
        focusPerf: t.focus.performance,
        perf: `${h.stats.performance} (+${h.gains.performance})`,
        rel: `${h.stats.reliability} (+${h.gains.reliability})`,
        budget: `${h.budget} (${h.income - h.upkeep >= 0 ? '+' : ''}${h.income - h.upkeep})`,
        score: h.score,
      };
    }),
  );
}

const normalize = (m) => JSON.stringify({ ...m, id: null });

// 1. Full run with output
const match = runMatch(!quiet);
console.log(`\nFinal standings (status: ${match.status})`);
console.table(
  [...match.teams]
    .sort((a, b) => computeScore(b) - computeScore(a))
    .map((t, i) => ({ place: i + 1, name: t.name, score: computeScore(t), perf: t.stats.performance, rel: t.stats.reliability, budget: t.budget })),
);

// 2. Determinism: same seed, same inputs → identical state
const again = runMatch(false);
const deterministic = normalize(match) === normalize(again);

// 3. Snapshot round-trip: stop halfway, JSON-serialize, restore, finish → identical to uninterrupted run
const half = Math.floor(rounds / 2);
const partial = createMatch({ seed, totalRounds: rounds });
for (let i = 0; i < teamCount; i++) addTeam(partial);
startMatch(partial);
playRounds(partial, 1, half, false);
const restored = JSON.parse(JSON.stringify(partial));
playRounds(restored, half + 1, rounds, false);
// playRounds seeds player inputs per starting round, so compare against a run split the same way
const reference = createMatch({ seed, totalRounds: rounds });
for (let i = 0; i < teamCount; i++) addTeam(reference);
startMatch(reference);
playRounds(reference, 1, half, false);
playRounds(reference, half + 1, rounds, false);
const snapshotSafe = normalize(restored) === normalize(reference);

console.log(`\nDeterministic with same seed: ${deterministic ? 'yes' : 'NO'}`);
console.log(`Snapshot/restore mid-match:   ${snapshotSafe ? 'yes' : 'NO'}`);
if (!deterministic || !snapshotSafe) process.exit(1);
