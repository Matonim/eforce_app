// Event engine CLI.
//
//   npm run sim:events                              one match with a round-by-round event feed
//   npm run sim:events -- --seed=abc --teams=8 --rounds=10
//   npm run sim:events -- --try=sensor_batch_failure   fire one event and play out every option
//   npm run sim:events -- --matches=200             balance stats across many seeds
//
// Fake players answer ~75% of decisions with a random available option and leave the rest to time out.

import { createRng, hashSeed } from '../src/game/rng.js';
import { DEPARTMENTS, MATCH_DEFAULTS, computeScore } from '../src/game/rules.js';
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
import { EventDefinitionError, createEventEngine } from '../src/events/engine.js';
import { pathLabel } from '../src/events/conditions.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  }),
);
const seed = String(args.seed ?? 'workshop');
const teamCount = Number(args.teams ?? 10);
const rounds = Number(args.rounds ?? MATCH_DEFAULTS.totalRounds);

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

let engine;
try {
  engine = createEventEngine(args.try ? { rolls: { teamEventChance: 0, globalEventChance: 0 } } : {});
} catch (err) {
  if (!(err instanceof EventDefinitionError)) throw err;
  console.error(err.message);
  console.error('\nRun `npm run events:check` for details.');
  process.exit(1);
}

// ---- Fake players -------------------------------------------------------------------

function playDecisionPhase(match, players) {
  for (const team of match.teams) {
    if (players.chance(0.6)) {
      // Driverless can only be staffed with the programme running, which these fake players skip.
      const pool = DEPARTMENTS.filter((d) => d !== 'driverless' || team.autonomous);
      const personnel = Object.fromEntries(DEPARTMENTS.map((d) => [d, 0]));
      for (let i = 0; i < headcount(team); i++) personnel[players.pick(pool)]++;
      setAllocation(match, team.id, personnel);
    }
    if (players.chance(0.6)) setFocus(match, team.id, players.int(0, 100));
    for (const decision of engine.decisionsView(match, team.id)) {
      const available = decision.options.filter((o) => o.available);
      if (available.length && players.chance(0.75)) {
        engine.answerDecision(match, team.id, decision.instanceId, players.pick(available).id);
      }
    }
  }
}

function runMatch(matchSeed, onRound) {
  const match = createMatch({ seed: matchSeed, totalRounds: rounds });
  for (let i = 0; i < teamCount; i++) addTeam(match);
  const players = createRng({ rngState: hashSeed(`players:${matchSeed}`) });
  startMatch(match);
  while (match.status === 'running') {
    playDecisionPhase(match, players);
    resolveRound(match, engine.hooks);
    onRound?.(match);
    advanceRound(match);
  }
  return match;
}

// ---- Formatting -----------------------------------------------------------------------

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const round1 = (n) => Math.round(n * 10) / 10;

function formatChange(c) {
  if (c.path.startsWith('active.')) return cyan(`⟳ ${c.label} (${c.to} rounds)`);
  const label = pathLabel(c.path);
  if (typeof c.from === 'number' && typeof c.to === 'number') return `${label} ${c.from}→${c.to} (${signed(round1(c.to - c.from))})`;
  return `${label} ${c.from}→${c.to}`;
}

function formatPreview(preview) {
  if (!preview) return dim('effects hidden');
  const parts = preview.effects.map((e) => {
    const label = pathLabel(e.path);
    const value = e.range ? `${e.range[0]}..${e.range[1]}` : e.value;
    if (e.op === 'multiply') return `${label} ×${value}`;
    if (e.op === 'set') return `${label} = ${value}`;
    if (e.per) return `${label} ${signed(value)} per ${pathLabel(e.per)} (≈ ${signed(e.estimate)})`;
    return `${label} ${e.range ? value : signed(value)}`;
  });
  if (preview.ongoing) parts.push(`⟳ ${preview.ongoing.label} for ${preview.ongoing.rounds} rounds`);
  return parts.length ? parts.join(', ') : dim('no effect');
}

function printLog(team, entries) {
  for (const entry of entries) {
    const changes = entry.changes.map(formatChange).join(', ') || dim('no change');
    const name = team.name.padEnd(18);
    if (entry.kind === 'event') {
      const tag = entry.source === 'random' ? '⚡' : entry.source === 'followUp' ? '↪' : '✋';
      console.log(`  ${name} ${tag} ${bold(entry.title)}  ${changes}${entry.decisionId ? yellow('  ? decision pending') : ''}`);
    } else if (entry.kind === 'decision') {
      console.log(`  ${name} ✔ ${entry.title} → ${bold(entry.choiceLabel)}  ${changes}`);
    } else {
      console.log(`  ${name} ${dim(`⟳ ${entry.title}`)}  ${dim(changes)}`);
    }
  }
}

function printPosts(posts) {
  for (const post of posts) console.log(`  ${cyan(`📣 ${post.text}`)}`);
}

// ---- Mode: single match feed -----------------------------------------------------------

function feed() {
  console.log(bold(`\nMatch · seed "${seed}" · ${teamCount} teams · ${rounds} rounds`));
  console.log(dim('⚡ random  ↪ follow-up  ✋ GM  ✔ decision settled  ⟳ ongoing  📣 public post\n'));
  const match = runMatch(seed, (m) => {
    console.log(bold(`Round ${m.round}`));
    for (const team of m.teams) printLog(team, team.eventLog.filter((e) => e.round === m.round));
    printPosts(m.feed.filter((p) => p.round === m.round));
  });

  console.log(bold('\nFinal standings'));
  console.table(
    [...match.teams]
      .sort((a, b) => computeScore(b) - computeScore(a))
      .map((t) => ({ name: t.name, score: computeScore(t), perf: t.stats.performance, rel: t.stats.reliability, budget: t.budget, events: t.eventLog.filter((e) => e.kind === 'event').length })),
  );

  const again = runMatch(seed);
  const same = JSON.stringify({ ...again, id: null }) === JSON.stringify({ ...match, id: null });
  console.log(`Deterministic with same seed: ${same ? 'yes' : 'NO'}`);
  if (!same) process.exit(1);
}

// ---- Mode: try one event ------------------------------------------------------------------

function tryEvent(eventId) {
  const def = engine.get(eventId);
  if (!def) {
    console.error(`No event "${eventId}". Known: ${engine.list().map((d) => d.id).join(', ')}`);
    process.exit(1);
  }

  const base = createMatch({ seed, totalRounds: 20 });
  for (let i = 0; i < 3; i++) addTeam(base);
  startMatch(base);
  const team = base.teams[0];

  console.log(bold(`\nTrying "${def.id}" — ${def.title}`), dim(`(${def.scope}, weight ${def.weight})`));
  console.log(`Team: ${team.name} · budget ${team.budget} · perf ${team.stats.performance} · rel ${team.stats.reliability} · ${JSON.stringify(team.personnel)}`);
  const { eligible, reasons } = engine.explain(base, def.id, team.id);
  console.log(`Randomly eligible for this team in round 1: ${eligible ? 'yes' : `no — ${reasons.join('; ')}`}`);

  engine.trigger(base, def.id, { teamIds: [team.id] });
  console.log(bold('\nFires:'));
  printLog(team, team.eventLog);
  printPosts(base.feed);

  const decision = engine.decisionsView(base, team.id)[0];
  const branches = [];
  if (decision) {
    console.log(bold(`\nDecision: ${decision.prompt}`));
    for (const o of decision.options) {
      const lock = o.available ? '' : yellow(` [locked: ${o.unavailableReason}]`);
      console.log(`  [${o.id}] ${bold(o.label)}${o.description ? dim(` — ${o.description}`) : ''}${lock}`);
      console.log(`      ${formatPreview(o.preview)}`);
      branches.push({ label: `option "${o.id}"`, optionId: o.available ? o.id : null, skip: !o.available });
    }
    const timeoutText = decision.onTimeout.option ? `same as "${decision.onTimeout.option}"` : formatPreview(decision.onTimeout.preview);
    console.log(`  ${dim('no answer →')} ${timeoutText}`);
    branches.push({ label: 'no answer (timeout)', optionId: null });
  } else if (def.ongoing || def.followUp) {
    branches.push({ label: 'aftermath', optionId: null });
  }

  const snapshot = JSON.stringify(base);
  for (const branch of branches) {
    console.log(bold(`\n▸ ${branch.label}`));
    if (branch.skip) {
      console.log(dim('  locked for this team — skipped'));
      continue;
    }
    const match = JSON.parse(snapshot);
    const t = match.teams[0];
    if (branch.optionId) engine.answerDecision(match, t.id, decision.instanceId, branch.optionId);
    // Play rounds (random rolls are off) until nothing from this event is pending, active or scheduled.
    for (let r = 0; r < 12; r++) {
      const resolving = match.round;
      const from = t.eventLog.length;
      const postsFrom = match.feed.length;
      resolveRound(match, engine.hooks);
      const entries = t.eventLog.slice(from);
      if (entries.length) {
        console.log(dim(`  round ${resolving}`));
        printLog(t, entries);
        printPosts(match.feed.slice(postsFrom));
      }
      advanceRound(match);
      if (!t.pendingDecisions.length && !t.scheduledEvents.length && !t.activeEffects.length) break;
    }
  }
  console.log();
}

// ---- Mode: statistics across many matches ------------------------------------------------

function stats(matchCount) {
  const perEvent = new Map(engine.list().map((d) => [d.id, { fired: 0, teamsHit: 0, matches: 0 }]));
  const choices = new Map();
  const scores = [];

  for (let i = 0; i < matchCount; i++) {
    const match = runMatch(`${seed}-${i}`);
    const firedHere = new Set();
    for (const h of match.eventHistory) {
      const row = perEvent.get(h.eventId);
      row.fired++;
      row.teamsHit += h.teamIds.length;
      firedHere.add(h.eventId);
    }
    for (const id of firedHere) perEvent.get(id).matches++;
    for (const team of match.teams) {
      scores.push(computeScore(team));
      for (const e of team.eventLog.filter((x) => x.kind === 'decision')) {
        const key = `${e.eventId} → ${e.choice}`;
        choices.set(key, (choices.get(key) ?? 0) + 1);
      }
    }
  }

  const totalTeams = matchCount * teamCount;
  console.log(bold(`\n${matchCount} matches · ${teamCount} teams · ${rounds} rounds (seeds "${seed}-0".."${seed}-${matchCount - 1}")`));
  console.table(
    [...perEvent].map(([id, r]) => {
      const def = engine.get(id);
      return {
        event: id,
        scope: def.scope,
        weight: def.weight,
        'fired / match': round1(r.fired / matchCount),
        'teams hit / match': round1(r.teamsHit / matchCount),
        'hits / team': Math.round((100 * r.teamsHit) / totalTeams) / 100,
        '% of matches': `${Math.round((100 * r.matches) / matchCount)}%`,
      };
    }),
  );
  if (choices.size) {
    console.log(bold('Decision outcomes'));
    console.table([...choices].sort().map(([choice, n]) => ({ choice, count: n })));
  }
  scores.sort((a, b) => a - b);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`Final score: mean ${round1(mean)} · min ${scores[0]} · median ${scores[Math.floor(scores.length / 2)]} · max ${scores.at(-1)}\n`);
}

// ---- Entry --------------------------------------------------------------------------------

if (args.try) tryEvent(String(args.try));
else if (args.matches) stats(Number(args.matches));
else feed();
