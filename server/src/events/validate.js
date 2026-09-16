// Validates /data/events.json: structure via the JSON Schema, then cross-references the schema
// can't express (unique ids, option references, flags that are read but never set, ...).
// Used by `npm run events:check` now, and by the event engine's loader later.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv from 'ajv';
import { DEPARTMENTS, STATS } from '../game/rules.js';
import { MODIFIER_KEYS } from '../game/match.js';
import { CHANGE_PATH, PLACEHOLDER, unknownPlaceholders } from './posts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, '../../../data');
export const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
export const SCHEMA_FILE = path.join(DATA_DIR, 'events.schema.json');

// Friendlier messages for the "one of several shapes" values in the schema.
const UNION_HINTS = {
  '#/definitions/numberTest/anyOf': 'expected a number or an operator object like { "min": 2 }',
  '#/definitions/stringTest/anyOf': 'expected a string or an operator object like { "in": ["CZ", "DE"] }',
  '#/definitions/valueTest/anyOf': 'expected true/false, a number, a string, or an operator object',
  '#/definitions/amount/anyOf': 'expected a number or a [min, max] range',
  '#/definitions/numberChange/anyOf': 'expected a number, [min, max], { "add": … }, { "multiply": … } or { "set": … }',
  '#/definitions/flagChange/anyOf': 'expected true/false, a number, a string, or { "set": … }',
  '#/definitions/decision/properties/onTimeout/anyOf': 'expected { "option": "<option id>" } or { "result": "…", "effects": … }',
};

/** Read + parse + validate the events file. Never throws; parse errors come back as errors. */
export function loadAndValidateEvents(eventsFile = EVENTS_FILE, schemaFile = SCHEMA_FILE) {
  let data;
  try {
    data = JSON.parse(readFileSync(eventsFile, 'utf8'));
  } catch (err) {
    return { data: null, errors: [`${path.basename(eventsFile)}: ${err.message}`], warnings: [] };
  }
  return { data, ...validateEvents(data, loadSchema(schemaFile)) };
}

export function loadSchema(schemaFile = SCHEMA_FILE) {
  return JSON.parse(readFileSync(schemaFile, 'utf8'));
}

export function validateEvents(data, schema) {
  const ajv = new Ajv({ allErrors: true, verbose: true, allowUnionTypes: true });
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    return { errors: pruneUnionNoise(validate.errors).map((e) => formatAjvError(e, data)), warnings: [] };
  }
  const errors = [];
  const warnings = [];
  checkCrossReferences(data.events, errors, warnings);
  checkSchemaMatchesRules(schema, warnings);
  return { errors, warnings };
}

// ---- Cross-reference checks ------------------------------------------------------

function checkCrossReferences(events, errors, warnings) {
  const seenIds = new Set();
  const flagsSet = new Set();
  const flagsRead = new Map(); // flag → first event reading it
  const ongoingIds = new Set();
  const activeRead = new Map();
  const followUps = []; // [target event id, where]

  for (const event of events) {
    const where = `event "${event.id}"`;
    if (seenIds.has(event.id)) errors.push(`${where}: duplicate id`);
    seenIds.add(event.id);

    if (!event.effects && !event.ongoing && !event.decision) {
      errors.push(`${where}: needs at least one of "effects", "ongoing" or "decision"`);
    }

    const readConditions = (conditions, at) =>
      walkConditions(conditions, (key) => {
        if (key.startsWith('flags.') && !flagsRead.has(key)) flagsRead.set(key, at);
        if (key.startsWith('active.') && !activeRead.has(key)) activeRead.set(key, at);
      });
    const readEffects = (effects, at) =>
      walkEffects(effects, (key, change) => {
        if (key.startsWith('flags.')) flagsSet.add(key);
        for (const range of amountsIn(change)) {
          if (range[0] > range[1]) errors.push(`${at} › ${key}: range [${range}] has min greater than max`);
        }
      });
    const readOutcome = (outcome, at) => {
      readEffects(outcome.effects, `${at} › effects`);
      if (outcome.ongoing) {
        const { ongoing } = outcome;
        if (!ongoing.perRound && !ongoing.modifiers) errors.push(`${at} › ongoing: needs "perRound", "modifiers" or both`);
        ongoingIds.add(`active.${ongoing.id ?? event.id}`);
        readEffects(ongoing.perRound, `${at} › ongoing.perRound`);
      }
      if (outcome.followUp) followUps.push([outcome.followUp.event, `${at} › followUp`]);
      if (outcome.post) checkPost(outcome, `${at} › post`);
    };

    const checkPost = (outcome, at) => {
      const unknown = unknownPlaceholders(outcome.post);
      if (unknown.length) {
        errors.push(`${at}: unknown placeholder ${unknown.map((u) => `{${u}}`).join(', ')} (use {team}, {location}, {country} or {change.<path>})`);
      }
      const changedPaths = Object.keys(outcome.effects ?? {}).map((p) => p.replace(/^personnel\.@\w+$/, 'personnel.any'));
      for (const [, key] of outcome.post.matchAll(PLACEHOLDER)) {
        if (!CHANGE_PATH.test(key)) continue;
        const path = key.slice('change.'.length);
        if (!changedPaths.some((p) => p === path || p.startsWith(`${path}.`) || path.startsWith(`${p}.`))) {
          warnings.push(`${at}: {${key}} but this outcome's effects don't change "${path}", so it will read 0`);
        }
      }
    };

    readConditions(event.conditions, where);
    readOutcome(event, where);

    const decision = event.decision;
    if (!decision) continue;
    const optionIds = new Set();
    for (const [i, option] of decision.options.entries()) {
      const at = `${where} › options[${i}] "${option.id}"`;
      if (optionIds.has(option.id)) errors.push(`${at}: duplicate option id`);
      optionIds.add(option.id);
      readConditions(option.requires, at);
      readOutcome(option, at);
    }
    const timeout = decision.onTimeout;
    if (timeout.option && !optionIds.has(timeout.option)) {
      errors.push(`${where} › onTimeout: no option with id "${timeout.option}" (have: ${[...optionIds].join(', ')})`);
    }
    readOutcome(timeout, `${where} › onTimeout`);
  }

  const followUpTargets = new Set();
  for (const [target, at] of followUps) {
    if (!seenIds.has(target)) errors.push(`${at}: no event with id "${target}"`);
    followUpTargets.add(target);
  }
  for (const event of events) {
    if (event.enabled !== false && event.weight === 0 && !followUpTargets.has(event.id)) {
      warnings.push(`event "${event.id}": weight is 0 and nothing follows up into it, so only the GM can trigger it`);
    }
  }

  for (const [flag, at] of flagsRead) {
    if (!flagsSet.has(flag)) warnings.push(`${at}: reads "${flag}" but no event ever sets it (typo?)`);
  }
  for (const [key, at] of activeRead) {
    if (!ongoingIds.has(key)) warnings.push(`${at}: reads "${key}" but no ongoing effect has that id (typo?)`);
  }
}

function walkConditions(conditions, visit) {
  if (!conditions) return;
  for (const [key, value] of Object.entries(conditions)) {
    if (key === 'any') value.forEach((c) => walkConditions(c, visit));
    else if (key === 'not') walkConditions(value, visit);
    else visit(key, value);
  }
}

function walkEffects(effects, visit) {
  if (!effects) return;
  for (const [key, change] of Object.entries(effects)) visit(key, change);
}

function amountsIn(change) {
  const candidates = [change, change?.add, change?.set];
  return candidates.filter((c) => Array.isArray(c));
}

/** The schema hardcodes department/stat names for editor autocomplete; warn if rules.js drifted. */
function checkSchemaMatchesRules(schema, warnings) {
  const defs = schema.definitions;
  const expect = (list, keys, where) => {
    for (const key of keys) if (!(key in list)) warnings.push(`events.schema.json: ${where} is missing "${key}" (defined in rules.js)`);
  };
  expect(defs.conditions.properties, [...DEPARTMENTS.map((d) => `personnel.${d}`), ...STATS.map((s) => `stats.${s}`)], 'conditions');
  expect(defs.effects.properties, [...DEPARTMENTS.map((d) => `personnel.${d}`), ...STATS.map((s) => `stats.${s}`)], 'effects');
  expect(defs.ongoing.properties.modifiers.properties, MODIFIER_KEYS, 'ongoing.modifiers');
  for (const key of Object.keys(defs.effects.properties)) {
    const dept = key.match(/^personnel\.([a-z]+)$/)?.[1];
    if (dept && !DEPARTMENTS.includes(dept)) warnings.push(`events.schema.json: department "${dept}" is not in rules.js DEPARTMENTS`);
  }
}

// ---- Ajv error formatting ---------------------------------------------------------

/**
 * For a value that failed every branch of an anyOf, Ajv reports each branch's failure. Drop the
 * branch mismatches at the value itself; keep errors nested deeper inside it (they're the real
 * problem), and keep the anyOf error only when nothing more specific exists.
 */
function pruneUnionNoise(errors) {
  const unions = errors.filter((e) => e.keyword === 'anyOf');
  return errors.filter((e) => {
    if (e.keyword === 'anyOf') {
      // Nested unions (numberChange → amount) report inner-first; keep only the outermost.
      const outermost = unions.findLast((u) => u.instancePath === e.instancePath) === e;
      return outermost && !errors.some((x) => x.instancePath.startsWith(`${e.instancePath}/`));
    }
    return !unions.some((u) => u.instancePath === e.instancePath);
  });
}

function formatAjvError(error, data) {
  const segments = error.instancePath.split('/').slice(1).map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'));
  let where = 'events.json';
  if (segments[0] === 'events' && segments[1] !== undefined) {
    const event = data.events[Number(segments[1])];
    where = typeof event?.id === 'string' ? `event "${event.id}"` : `events[${segments[1]}]`;
    segments.splice(0, 2);
  }
  const parts = [where];
  for (const s of segments) {
    if (/^\d+$/.test(s)) parts[parts.length - 1] += `[${s}]`;
    else parts.push(s);
  }
  const location = parts.join(' › ');

  let message = error.message;
  if (error.keyword === 'anyOf') message = UNION_HINTS[error.schemaPath] ?? message;
  if (error.keyword === 'additionalProperties') {
    const key = error.params.additionalProperty;
    const suggestion = closest(key, Object.keys(error.parentSchema.properties ?? {}));
    message = `unknown key "${key}"${suggestion ? ` — did you mean "${suggestion}"?` : ''}`;
  }
  if (error.keyword === 'enum') message = `must be one of: ${error.params.allowedValues.join(', ')}`;
  return `${location}: ${message}`;
}

function closest(word, candidates) {
  let best;
  let bestDistance = Math.max(3, Math.floor(word.length / 3)) + 1;
  for (const candidate of candidates) {
    const d = levenshtein(word.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) [best, bestDistance] = [candidate, d];
  }
  return best;
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}
