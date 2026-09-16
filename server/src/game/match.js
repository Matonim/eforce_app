// In-memory match state and the core (non-event) game rules.
// Pure state transitions: no timers, no sockets. The phase loop (phases.js) and the
// socket layer (net/sockets.js) call into these functions; the event engine plugs in via hooks.

import { createRng, hashSeed } from './rng.js';
import {
  ANNOUNCEMENT_MAX_LENGTH,
  AUTONOMOUS,
  CONTRIBUTION,
  DEPARTMENTS,
  ECONOMY,
  FOCUSED_STATS,
  FOCUS_MULTIPLIER,
  MATCH_DEFAULTS,
  MATCH_LIMITS,
  MAX_BUDGET_EDIT,
  MAX_TIME_ADJUST_SECONDS,
  SEASON,
  SETUP,
  STAT_LIMITS,
  STATS,
  computeScore,
} from './rules.js';

/** @typedef {import('./model.js').Match} Match */
/** @typedef {import('./model.js').Team} Team */

export class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Multipliers an active effect may set. Anything not listed is rejected when events load. */
export const MODIFIER_KEYS = [
  ...DEPARTMENTS.map((d) => `output.${d}`),
  ...STATS.map((s) => `gain.${s}`),
  'income',
  'upkeep',
];

const MAX_NAME_LENGTH = 24;

// ---- Creation ---------------------------------------------------------------

/** @returns {Match} */
export function createMatch(configOverrides = {}) {
  const config = { ...MATCH_DEFAULTS, seed: 'workshop', ...configOverrides };
  config.seed = String(config.seed);
  return {
    id: `m-${Date.now().toString(36)}`,
    status: 'lobby',
    phase: 'lobby',
    round: 0,
    phaseEndsAt: null,
    pausedRemainingMs: null,
    config,
    rngState: hashSeed(config.seed),
    nextTeamNumber: 1,
    nextDecisionNumber: 1,
    nextPostNumber: 1,
    teams: [],
    eventHistory: [],
    feed: [],
    race: null, // filled in when the GM starts the end-of-season competition
  };
}

/**
 * Join a new team (lobby only; late joins are not allowed). A given name must be unique
 * (case-insensitive); without a name the team is called "Team <city>".
 * @returns {Team}
 */
export function addTeam(match, { name } = {}) {
  if (match.status !== 'lobby') throw new GameError('not_lobby', 'Joining is closed: the match has already started');
  if (match.teams.length >= match.config.maxTeams) throw new GameError('match_full', 'Match is full');
  const chosenName = cleanName(name);
  if (chosenName && isNameTaken(match, chosenName)) throw new GameError('name_taken', `"${chosenName}" is already taken`);

  const rng = createRng(match);
  const usedLocations = new Set(match.teams.map((t) => t.location.id));
  const freeLocations = SETUP.locations.filter((l) => !usedLocations.has(l.id));
  const location = { ...rng.pick(freeLocations.length ? freeLocations : SETUP.locations) };

  const number = match.nextTeamNumber++;
  const { budget, headcount, minPerDepartment } = SETUP;

  const staffable = DEPARTMENTS.filter((d) => !SETUP.optionalDepartments.includes(d));
  const personnel = Object.fromEntries(DEPARTMENTS.map((d) => [d, staffable.includes(d) ? minPerDepartment : 0]));
  const total = rng.int(headcount.min, headcount.max);
  for (let i = staffable.length * minPerDepartment; i < total; i++) personnel[rng.pick(staffable)]++;

  const stats = Object.fromEntries(STATS.map((s) => [s, rng.int(SETUP.stats[s].min, SETUP.stats[s].max)]));
  // Bigger teams tend to be better funded, but the money per member varies a lot.
  const perMember = rng.int(budget.perMember.min, budget.perMember.max);
  const startingBudget = Math.min(budget.max, Math.max(budget.min, Math.round((total * perMember) / budget.step) * budget.step));

  /** @type {Team} */
  const team = {
    id: `t${number}`,
    name: chosenName || defaultName(match, location),
    color: SETUP.colors[(number - 1) % SETUP.colors.length],
    location,
    budget: startingBudget,
    start: { budget: startingBudget, stats: { ...stats } },
    personnel,
    focus: { performance: SETUP.focusPerformance, reliability: 100 - SETUP.focusPerformance },
    stats,
    autonomous: false, // the driverless programme is opt-in; see setAutonomous
    flags: {},
    activeEffects: [],
    pendingDecisions: [],
    scheduledEvents: [],
    eventLog: [],
    history: [],
  };
  match.teams.push(team);
  return team;
}

/** Remove a team (lobby only). */
export function removeTeam(match, teamId) {
  if (match.status !== 'lobby') throw new GameError('not_lobby', 'Teams can only leave in the lobby');
  const team = getTeam(match, teamId);
  match.teams = match.teams.filter((t) => t !== team);
  return team;
}

// ---- Lookups & helpers ------------------------------------------------------

/** @returns {Team} */
export function getTeam(match, teamId) {
  const team = match.teams.find((t) => t.id === teamId);
  if (!team) throw new GameError('unknown_team', `No team with id "${teamId}"`);
  return team;
}

export function headcount(team) {
  return DEPARTMENTS.reduce((sum, d) => sum + (team.personnel[d] ?? 0), 0);
}

/** Combined multiplier from all active effects for a modifier key (1 when none apply). */
export function teamModifier(team, key) {
  return team.activeEffects.reduce((product, effect) => product * (effect.modifiers?.[key] ?? 1), 1);
}

export function clampStat(stat, value) {
  const { min, max } = STAT_LIMITS[stat];
  return round1(Math.min(max, Math.max(min, value)));
}

export function round1(n) {
  return Math.round(n * 10) / 10;
}

function cleanName(name) {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim() : '';
}

function isNameTaken(match, name) {
  const wanted = name.toLowerCase();
  return match.teams.some((t) => t.name.toLowerCase() === wanted);
}

function defaultName(match, location) {
  const base = `Team ${location.name}`;
  let name = base;
  for (let n = 2; isNameTaken(match, name); n++) name = `${base} ${n}`;
  return name;
}

// ---- Team decisions (validated; only while decisions are open) --------------

export function assertDecisionsOpen(match) {
  const open = match.status === 'lobby' || (match.status === 'running' && match.phase === 'decision');
  if (!open) throw new GameError('decisions_closed', 'Decisions are closed right now');
}

/** Redistribute existing personnel. Headcount must stay the same; only events change it. */
export function setAllocation(match, teamId, personnel) {
  assertDecisionsOpen(match);
  const team = getTeam(match, teamId);
  if (!personnel || typeof personnel !== 'object') throw new GameError('invalid_allocation', 'Allocation must be an object');

  const next = {};
  for (const dept of DEPARTMENTS) {
    const count = personnel[dept];
    if (!Number.isInteger(count) || count < 0) {
      throw new GameError('invalid_allocation', `"${dept}" must be a non-negative integer`);
    }
    next[dept] = count;
  }
  const unknown = Object.keys(personnel).filter((k) => !DEPARTMENTS.includes(k));
  if (unknown.length) throw new GameError('invalid_allocation', `Unknown departments: ${unknown.join(', ')}`);

  if (!team.autonomous && next.driverless > 0) {
    throw new GameError('needs_autonomous', 'Start the driverless programme before staffing that department');
  }

  const total = Object.values(next).reduce((a, b) => a + b, 0);
  if (total !== headcount(team)) {
    throw new GameError('invalid_allocation', `Allocation totals ${total}, team has ${headcount(team)} people`);
  }
  team.personnel = next;
  return team;
}

/**
 * Start or stop the driverless programme. Starting costs a one-off fee and unlocks the driverless
 * department, the autonomy stat and the DV disciplines; it also makes the team more interesting to
 * sponsors. Stopping is only possible once nobody is staffed there, and the fee isn't refunded.
 */
export function setAutonomous(match, teamId, enabled) {
  assertDecisionsOpen(match);
  const team = getTeam(match, teamId);
  const wanted = Boolean(enabled);
  if (wanted === team.autonomous) return team;

  if (wanted) {
    if (team.budget < AUTONOMOUS.setupCost) {
      throw new GameError('cannot_afford', `Starting the programme costs €${AUTONOMOUS.setupCost.toLocaleString('en-US')}`);
    }
    team.budget -= AUTONOMOUS.setupCost;
    team.autonomous = true;
    team.eventLog.push({
      kind: 'programme',
      round: match.round,
      eventId: null,
      title: 'Driverless programme started',
      text: `Sensors, compute and a safety system. €${AUTONOMOUS.perRoundCost.toLocaleString('en-US')} per round from now on, and sponsors are paying attention.`,
      changes: [{ path: 'budget', from: team.budget + AUTONOMOUS.setupCost, to: team.budget }],
    });
  } else {
    if ((team.personnel.driverless ?? 0) > 0) {
      throw new GameError('driverless_staffed', 'Move your driverless staff to other departments first');
    }
    team.autonomous = false;
    team.eventLog.push({
      kind: 'programme',
      round: match.round,
      eventId: null,
      title: 'Driverless programme stopped',
      text: 'No more running costs — and no points in the driverless disciplines.',
      changes: [],
    });
  }
  return team;
}

/** performance: 0..100; reliability is the remainder. */
export function setFocus(match, teamId, performance) {
  assertDecisionsOpen(match);
  const team = getTeam(match, teamId);
  if (typeof performance !== 'number' || !Number.isFinite(performance)) {
    throw new GameError('invalid_focus', 'Focus must be a number from 0 to 100');
  }
  const p = Math.round(Math.min(100, Math.max(0, performance)));
  team.focus = { performance: p, reliability: 100 - p };
  return team;
}

// ---- Lifecycle ----------------------------------------------------------------

export function startMatch(match) {
  if (match.status !== 'lobby') throw new GameError('not_lobby', 'Match already started');
  if (match.teams.length === 0) throw new GameError('no_teams', 'Need at least one team');
  match.status = 'running';
  match.round = 1;
  match.phase = 'decision';
}

export function pauseMatch(match, now = Date.now()) {
  if (match.status !== 'running') throw new GameError('not_running', 'Match is not running');
  match.status = 'paused';
  match.pausedRemainingMs = match.phaseEndsAt == null ? null : Math.max(0, match.phaseEndsAt - now);
  match.phaseEndsAt = null;
}

export function resumeMatch(match, now = Date.now()) {
  if (match.status !== 'paused') throw new GameError('not_paused', 'Match is not paused');
  match.status = 'running';
  match.phaseEndsAt = match.pausedRemainingMs == null ? null : now + match.pausedRemainingMs;
  match.pausedRemainingMs = null;
}

export function endMatch(match) {
  match.status = 'ended';
  match.phase = 'ended';
  match.phaseEndsAt = null;
  match.pausedRemainingMs = null;
}

// ---- Phase timing -------------------------------------------------------------------
// The match only stores *when* the current phase ends; phases.js owns the actual timers.

/** Lobby only: change the number of rounds and phase durations (limits in MATCH_LIMITS). */
export function configureMatch(match, patch) {
  if (match.status !== 'lobby') throw new GameError('not_lobby', 'Settings can only be changed in the lobby');
  if (!patch || typeof patch !== 'object') throw new GameError('invalid_config', 'Settings must be an object');
  const unknown = Object.keys(patch).filter((key) => !(key in MATCH_LIMITS));
  if (unknown.length) throw new GameError('invalid_config', `Unknown settings: ${unknown.join(', ')}`);

  const next = {};
  for (const [key, { min, max }] of Object.entries(MATCH_LIMITS)) {
    if (patch[key] === undefined) continue;
    const value = patch[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new GameError('invalid_config', `${key} must be a whole number from ${min} to ${max}`);
    }
    next[key] = value;
  }
  Object.assign(match.config, next);
  return match.config;
}

/** Start the clock for the current phase from the configured duration. */
export function startPhaseTimer(match, now) {
  const seconds =
    match.phase === 'decision' ? match.config.decisionSeconds : match.phase === 'resolution' ? match.config.resolutionSeconds : null;
  match.phaseEndsAt = seconds == null ? null : now + Math.round(seconds * 1000);
}

/** Add (positive) or remove (negative) time from the current phase. Never leaves less than 1 second. */
export function adjustPhaseTime(match, seconds, now) {
  if (!Number.isInteger(seconds) || seconds === 0 || Math.abs(seconds) > MAX_TIME_ADJUST_SECONDS) {
    throw new GameError('invalid_seconds', `Seconds must be a whole number from -${MAX_TIME_ADJUST_SECONDS} to ${MAX_TIME_ADJUST_SECONDS}, not 0`);
  }
  const ms = seconds * 1000;
  if (match.status === 'running' && match.phaseEndsAt != null) {
    match.phaseEndsAt = Math.max(now + 1000, match.phaseEndsAt + ms);
  } else if (match.status === 'paused' && match.pausedRemainingMs != null) {
    match.pausedRemainingMs = Math.max(1000, match.pausedRemainingMs + ms);
  } else {
    throw new GameError('not_running', 'No phase timer is running');
  }
}

/**
 * Back to the lobby with the same config. Teams are re-created in join order with the same
 * names, ids and colors, so connected clients stay attached. Same seed → same starting state.
 */
export function resetMatch(match, { keepTeams = true, seed = match.config.seed } = {}) {
  const fresh = createMatch({ ...match.config, seed });
  if (keepTeams) {
    for (const old of match.teams) {
      const team = addTeam(fresh, { name: old.name });
      team.id = old.id;
      team.color = old.color;
    }
    fresh.nextTeamNumber = match.nextTeamNumber;
  }
  fresh.id = match.id;
  for (const key of Object.keys(match)) delete match[key];
  Object.assign(match, fresh);
}

// ---- Game Master corrections -----------------------------------------------------
// Live fixes for when something goes wrong in the room. Only the budget can be edited;
// everything else should come from the game itself.

/**
 * Set a team's budget. The change is written to the team's log so the team can see it happened.
 * @returns {import('./model.js').Change[]}
 */
export function patchTeam(match, teamId, patch) {
  if (match.status === 'ended') throw new GameError('match_ended', 'Match has ended');
  const team = getTeam(match, teamId);
  const fields = Object.keys(patch ?? {});
  const unknown = fields.filter((key) => key !== 'budget');
  if (unknown.length) throw new GameError('invalid_patch', `Only the budget can be edited (got: ${unknown.join(', ')})`);
  if (!fields.length) throw new GameError('invalid_patch', 'Nothing to change');

  const { budget } = patch;
  if (!Number.isInteger(budget) || Math.abs(budget) > MAX_BUDGET_EDIT) {
    throw new GameError('invalid_patch', `Budget must be a whole number between -${MAX_BUDGET_EDIT} and ${MAX_BUDGET_EDIT}`);
  }
  if (budget === team.budget) return [];

  const changes = [{ path: 'budget', from: team.budget, to: budget }];
  team.budget = budget;
  team.eventLog.push({
    kind: 'gm',
    round: match.round,
    eventId: null,
    title: 'Game Master adjustment',
    text: 'The organisers corrected your budget.',
    changes,
  });
  return changes;
}

/** Post an announcement to the public feed as the organisers ("Race Control"). */
export function addAnnouncement(match, text) {
  const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, ANNOUNCEMENT_MAX_LENGTH) : '';
  if (!clean) throw new GameError('invalid_post', 'Write something to post');
  const post = { id: `p${match.nextPostNumber++}`, round: match.round, teamId: null, eventId: null, source: 'gm', text: clean };
  match.feed.push(post);
  return post;
}

// ---- Round resolution -----------------------------------------------------------

/**
 * Resolve the current round.
 * Order: hooks.beforeProduction (settle decisions, per-round effects) → production & economy →
 * tick active-effect durations → hooks.afterProduction (roll new events) → record history.
 *
 * @param {Match} match
 * @param {{ beforeProduction?: (m: Match) => void, afterProduction?: (m: Match) => void }} hooks
 */
export function resolveRound(match, hooks = {}) {
  if (match.status !== 'running') throw new GameError('not_running', 'Match is not running');
  match.phase = 'resolution';
  match.phaseEndsAt = null;

  hooks.beforeProduction?.(match);

  const reports = new Map();
  for (const team of match.teams) {
    reports.set(team.id, produce(team, match));
    tickActiveEffects(team);
  }

  hooks.afterProduction?.(match);

  for (const team of match.teams) {
    team.history.push({
      round: match.round,
      ...reports.get(team.id),
      stats: { ...team.stats },
      budget: team.budget,
      score: computeScore(team),
    });
  }
}

/** Move to the next round's decision phase, or end the match after the last round. */
export function advanceRound(match) {
  if (match.round >= match.config.totalRounds) {
    endMatch(match);
    return { ended: true };
  }
  match.round += 1;
  match.phase = 'decision';
  return { ended: false };
}

export function focusMultiplier(value) {
  return FOCUS_MULTIPLIER.min + (FOCUS_MULTIPLIER.max - FOCUS_MULTIPLIER.min) * (value / 100);
}

/** Department output with diminishing returns: members ^ SEASON.staffExponent. */
export function staffOutput(members) {
  return members > 0 ? members ** SEASON.staffExponent : 0;
}

/** How much one round counts for: 1 in a season of SEASON.referenceRounds, more in a shorter one. */
export function seasonScale(match) {
  return SEASON.referenceRounds / Math.max(1, match.config.totalRounds);
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * What this round's production would do with the team's current staff, focus and active modifiers,
 * without changing anything. Random events and per-round ongoing effects are not included.
 *
 * Besides the totals, `departments` breaks it down per department — what it produces now and what
 * one more person there would add — so the team screen can show diminishing returns without
 * reimplementing the rules.
 */
export function projectProduction(team, match) {
  const mod = (key) => teamModifier(team, key);
  const scale = seasonScale(match);
  const costLevel = team.location.costLevel ?? 1;
  const sponsorLevel = team.location.sponsorLevel ?? 1;
  // A driverless programme draws industry interest, which shows up as sponsorship money.
  const interest = team.autonomous ? AUTONOMOUS.incomeMultiplier : 1;

  // Multiplier from one unit of raw contribution to the actual gain of each stat this round.
  const factor = Object.fromEntries(
    STATS.map((stat) => {
      if (stat === 'autonomy' && !team.autonomous) return [stat, 0]; // only grows with the programme
      // The focus slider only trades performance against reliability; autonomy is unaffected.
      const focus = FOCUSED_STATS.includes(stat) ? focusMultiplier(team.focus[stat]) : 1;
      // Improving a good car is harder: gains shrink as the stat approaches its maximum.
      const headroom = Math.max(0, 1 - team.stats[stat] / STAT_LIMITS[stat].max);
      return [stat, focus * mod(`gain.${stat}`) * headroom * scale];
    }),
  );
  const sponsorshipPerOutput = ECONOMY.sponsorshipPerOutput * sponsorLevel * interest * mod('income') * scale;

  const raw = Object.fromEntries(STATS.map((s) => [s, 0]));
  let sponsorship = 0;
  const departments = {};
  for (const dept of DEPARTMENTS) {
    const members = team.personnel[dept] ?? 0;
    const output = staffOutput(members) * mod(`output.${dept}`);
    const nextOutput = (staffOutput(members + 1) - staffOutput(members)) * mod(`output.${dept}`);
    for (const stat of STATS) raw[stat] += output * CONTRIBUTION[dept][stat];
    if (dept === 'business') sponsorship += output * sponsorshipPerOutput;

    departments[dept] = {
      members,
      ...Object.fromEntries(STATS.map((stat) => [stat, round2(output * CONTRIBUTION[dept][stat] * factor[stat])])),
      sponsorship: dept === 'business' ? Math.round(output * sponsorshipPerOutput) : 0,
      nextPerson: {
        ...Object.fromEntries(STATS.map((stat) => [stat, round2(nextOutput * CONTRIBUTION[dept][stat] * factor[stat])])),
        sponsorship: dept === 'business' ? Math.round(nextOutput * sponsorshipPerOutput) : 0,
        cost: Math.round(ECONOMY.costPerMember * costLevel * mod('upkeep') * scale),
      },
    };
  }

  const stats = {};
  const gains = {};
  for (const stat of STATS) {
    stats[stat] = clampStat(stat, team.stats[stat] + raw[stat] * factor[stat]);
    gains[stat] = round1(stats[stat] - team.stats[stat]);
  }

  const income = Math.round(ECONOMY.baseIncome * interest * mod('income') * scale + sponsorship);
  const programme = team.autonomous ? AUTONOMOUS.perRoundCost : 0;
  const upkeep = Math.round((headcount(team) * ECONOMY.costPerMember + programme) * costLevel * mod('upkeep') * scale);
  // What the driverless programme costs this team per round, running or not (shown before starting it).
  const programmeCost = Math.round(AUTONOMOUS.perRoundCost * costLevel * mod('upkeep') * scale);
  return { gains, income, upkeep, net: income - upkeep, stats, departments, programmeCost };
}

function produce(team, match) {
  const { gains, income, upkeep, stats } = projectProduction(team, match);
  team.stats = stats;
  team.budget += income - upkeep;
  return { gains, income, upkeep };
}

function tickActiveEffects(team) {
  for (const effect of team.activeEffects) effect.roundsLeft -= 1;
  team.activeEffects = team.activeEffects.filter((e) => e.roundsLeft > 0);
}
