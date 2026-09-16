// Applying event effects and ongoing effects to a team, generically from their JSON definitions.
// Also builds the effect previews teams see on decision options (unless hideEffects is set).

import { DEPARTMENTS } from '../game/rules.js';
import { clampStat, round1 } from '../game/match.js';
import { readPath } from './conditions.js';

/** @typedef {import('./conditions.js').Scope} Scope */
/** @typedef {import('../game/model.js').Change} Change */

/**
 * @param {Record<string, any>} effects
 * @param {Scope} scope
 * @returns {Change[]} what actually changed (no-ops are left out)
 */
export function applyEffects(effects, team, scope) {
  const changes = [];
  for (const [rawPath, change] of Object.entries(effects ?? {})) {
    const path = resolveTarget(rawPath, change, team, scope);
    if (!path) continue;
    const from = readPath(path, team, scope);
    const to = normalize(path, nextValue(from, change, team, scope));
    write(path, to, team);
    if (from !== to) changes.push({ path, from, to });
  }
  return changes;
}

/**
 * Start an ongoing effect. An effect with the same id restarts with the new definition
 * instead of stacking.
 * @returns {Change}
 */
export function addOngoing(ongoing, sourceEventId, team) {
  const id = ongoing.id ?? sourceEventId;
  const effect = {
    id,
    sourceEventId,
    label: ongoing.label,
    roundsLeft: ongoing.rounds,
    ...(ongoing.perRound && { perRound: structuredClone(ongoing.perRound) }),
    ...(ongoing.modifiers && { modifiers: structuredClone(ongoing.modifiers) }),
  };
  const index = team.activeEffects.findIndex((e) => e.id === id);
  const from = index === -1 ? 0 : team.activeEffects[index].roundsLeft;
  if (index === -1) team.activeEffects.push(effect);
  else team.activeEffects[index] = effect;
  return { path: `active.${id}`, from, to: ongoing.rounds, label: ongoing.label };
}

// ---- Internals --------------------------------------------------------------------

function amount(value, scope) {
  if (!Array.isArray(value)) return value;
  const [a, b] = value.map(Math.round);
  return scope.rng.int(Math.min(a, b), Math.max(a, b));
}

function asNumber(value) {
  return typeof value === 'number' ? value : Number(value) || 0;
}

function nextValue(current, change, team, scope) {
  if (typeof change === 'boolean' || typeof change === 'string') return change;
  if (typeof change === 'number' || Array.isArray(change)) return asNumber(current) + amount(change, scope);
  if ('add' in change) {
    const factor = change.per ? readPath(change.per, team, scope) : 1;
    return asNumber(current) + amount(change.add, scope) * factor;
  }
  if ('multiply' in change) return asNumber(current) * change.multiply;
  if ('set' in change) return amount(change.set, scope);
  throw new Error(`Unsupported effect ${JSON.stringify(change)}`);
}

function normalize(path, value) {
  if (path === 'budget') return Math.round(value);
  if (path.startsWith('stats.')) return clampStat(path.slice(6), value);
  if (path.startsWith('personnel.')) return Math.max(0, Math.round(value));
  if (path.startsWith('flags.') && typeof value === 'number') return round1(value);
  return value;
}

function write(path, value, team) {
  const [root, key] = [path.slice(0, path.indexOf('.')), path.slice(path.indexOf('.') + 1)];
  if (path === 'budget') team.budget = value;
  else if (root === 'stats') team.stats[key] = value;
  else if (root === 'personnel') team.personnel[key] = value;
  else if (root === 'flags') team.flags[key] = value;
  else throw new Error(`State path "${path}" is not writable`);
}

/** personnel.@random / @largest / @smallest → a concrete department (or null if nobody to remove). */
function resolveTarget(path, change, team, scope) {
  if (!path.startsWith('personnel.@')) return path;
  const selector = path.slice('personnel.@'.length);
  const candidates = isRemoval(change) ? DEPARTMENTS.filter((d) => team.personnel[d] > 0) : [...DEPARTMENTS];
  if (!candidates.length) return null;

  let pool = candidates;
  if (selector === 'largest' || selector === 'smallest') {
    const counts = candidates.map((d) => team.personnel[d]);
    const target = selector === 'largest' ? Math.max(...counts) : Math.min(...counts);
    pool = candidates.filter((d) => team.personnel[d] === target);
  }
  return `personnel.${pool.length === 1 ? pool[0] : scope.rng.pick(pool)}`;
}

function isRemoval(change) {
  const upper = (v) => (Array.isArray(v) ? Math.max(...v) : v);
  if (typeof change === 'number' || Array.isArray(change)) return upper(change) < 0;
  if (change && 'add' in change) return upper(change.add) < 0;
  if (change && 'multiply' in change) return change.multiply < 1;
  return false;
}

// ---- Previews ----------------------------------------------------------------------

/**
 * Structured, UI-agnostic description of what an outcome would do. Flags and follow-ups are
 * internal and never previewed.
 * @param {{ effects?: object, ongoing?: object }} outcome
 * @param {Scope} scope
 */
export function previewOutcome(outcome, team, scope) {
  const list = (effects) =>
    Object.entries(effects ?? {})
      .filter(([path]) => !path.startsWith('flags.'))
      .map(([path, change]) => previewChange(path, change, team, scope));
  const ongoing = outcome.ongoing
    ? {
        label: outcome.ongoing.label,
        rounds: outcome.ongoing.rounds,
        modifiers: outcome.ongoing.modifiers ?? null,
        perRound: list(outcome.ongoing.perRound),
      }
    : null;
  return { effects: list(outcome.effects), ongoing };
}

function previewChange(path, change, team, scope) {
  if (typeof change === 'number') return { path, op: 'add', value: change };
  if (Array.isArray(change)) return { path, op: 'add', range: change };
  if ('add' in change) {
    const base = Array.isArray(change.add) ? { range: change.add } : { value: change.add };
    if (!change.per) return { path, op: 'add', ...base };
    const factor = readPath(change.per, team, scope);
    const estimate = Array.isArray(change.add) ? change.add.map((v) => v * factor) : change.add * factor;
    return { path, op: 'add', ...base, per: change.per, estimate };
  }
  if ('multiply' in change) return { path, op: 'multiply', value: change.multiply };
  return { path, op: 'set', ...(Array.isArray(change.set) ? { range: change.set } : { value: change.set }) };
}
