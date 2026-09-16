// Reading state paths ("personnel.aero", "rank.score", "flags.x", ...) and evaluating
// event conditions against a team. Paths and operators are documented in events.schema.json.

import { computeScore } from '../game/rules.js';
import { headcount } from '../game/match.js';

/**
 * Per-pass evaluation context. Ranks are computed lazily once per scope, so create a new
 * scope for each resolution step rather than keeping one around.
 * @typedef {{ match: import('../game/model.js').Match, rng: ReturnType<import('../game/rng.js').createRng>, ranks: Map<string, Record<string, number>> | null }} Scope
 */

const RANK_VALUES = {
  performance: (t) => t.stats.performance,
  reliability: (t) => t.stats.reliability,
  autonomy: (t) => t.stats.autonomy,
  budget: (t) => t.budget,
  score: (t) => computeScore(t),
};

/** Competition ranking per team: 1 = best, ties share the better place. */
export function computeRanks(match) {
  const ranks = new Map(match.teams.map((t) => [t.id, {}]));
  for (const [key, valueOf] of Object.entries(RANK_VALUES)) {
    const values = match.teams.map(valueOf);
    match.teams.forEach((team, i) => {
      ranks.get(team.id)[key] = 1 + values.filter((v) => v > values[i]).length;
    });
  }
  return ranks;
}

/** @param {Scope} scope */
export function readPath(path, team, scope) {
  const dot = path.indexOf('.');
  const root = dot === -1 ? path : path.slice(0, dot);
  const key = dot === -1 ? '' : path.slice(dot + 1);

  switch (root) {
    case 'round':
      return scope.match.round;
    case 'budget':
      return team.budget;
    case 'autonomous':
      return Boolean(team.autonomous);
    case 'stats':
      return team.stats[key];
    case 'focus':
      return team.focus[key];
    case 'personnel':
      return key === 'total' ? headcount(team) : (team.personnel[key] ?? 0);
    case 'location':
      return team.location[key];
    case 'rank':
      scope.ranks ??= computeRanks(scope.match);
      return scope.ranks.get(team.id)[key];
    case 'flags':
      return team.flags[key] ?? false;
    case 'active':
      return team.activeEffects.some((e) => e.id === key);
    default:
      throw new Error(`Unknown state path "${path}"`);
  }
}

/** @param {Scope} scope */
export function checkConditions(conditions, team, scope) {
  return failingConditions(conditions, team, scope).length === 0;
}

/**
 * Human-readable descriptions of the top-level entries that don't hold, e.g. ["budget ≥ 2500"].
 * Empty array = all conditions pass.
 * @param {Scope} scope
 */
export function failingConditions(conditions, team, scope) {
  if (!conditions) return [];
  const failing = [];
  for (const [key, expected] of Object.entries(conditions)) {
    let ok;
    if (key === 'any') ok = expected.some((c) => checkConditions(c, team, scope));
    else if (key === 'not') ok = !checkConditions(expected, team, scope);
    else ok = testValue(readPath(key, team, scope), expected);
    if (!ok) failing.push(describeEntry(key, expected));
  }
  return failing;
}

function testValue(actual, expected) {
  if (expected === null || typeof expected !== 'object') return same(actual, expected);
  const { min, max, eq, ne, in: oneOf, notIn } = expected;
  if (min !== undefined && !(asNumber(actual) >= min)) return false;
  if (max !== undefined && !(asNumber(actual) <= max)) return false;
  if (eq !== undefined && !same(actual, eq)) return false;
  if (ne !== undefined && same(actual, ne)) return false;
  if (oneOf !== undefined && !oneOf.some((v) => same(actual, v))) return false;
  if (notIn !== undefined && notIn.some((v) => same(actual, v))) return false;
  return true;
}

// Flags mix booleans and counters: unset flags read as false, and false/true compare as 0/1.
function asNumber(v) {
  if (typeof v === 'boolean') return Number(v);
  return typeof v === 'number' ? v : NaN;
}

function same(a, b) {
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    if (typeof a !== 'string' && typeof b !== 'string') return asNumber(a) === asNumber(b);
  }
  return a === b;
}

// ---- Descriptions (shown to teams as "Requires …") ---------------------------------

const OPERATOR_TEXT = {
  min: (v) => `≥ ${v}`,
  max: (v) => `≤ ${v}`,
  eq: (v) => `= ${v}`,
  ne: (v) => `≠ ${v}`,
  in: (v) => `one of ${v.join(', ')}`,
  notIn: (v) => `not ${v.join(', ')}`,
};

export function describeConditions(conditions) {
  return Object.entries(conditions ?? {}).map(([key, expected]) => describeEntry(key, expected));
}

function describeEntry(key, expected) {
  if (key === 'any') return `(${expected.map((c) => describeConditions(c).join(' and ')).join(' or ')})`;
  if (key === 'not') return `not (${describeConditions(expected).join(' and ')})`;
  const label = pathLabel(key);
  if (expected === null || typeof expected !== 'object') return `${label} = ${expected}`;
  return Object.entries(expected)
    .map(([op, value]) => `${label} ${OPERATOR_TEXT[op](value)}`)
    .join(' and ');
}

export function pathLabel(path) {
  if (path === 'personnel.total') return 'team size';
  if (path.startsWith('personnel.')) return `${path.slice(10)} staff`;
  if (path.startsWith('stats.') || path.startsWith('focus.')) return path.replace('.', ' ').replace(/^stats /, '');
  if (path.startsWith('rank.')) return `${path.slice(5)} rank`;
  return path;
}
