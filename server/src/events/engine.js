// Event engine: loads definitions from /data/events.json, rolls weighted-random events per team and
// per match, applies outcomes generically, and runs the decision + follow-up lifecycle.
//
// Round timeline (see resolveRound in game/match.js):
//   decision phase     teams answer pending decisions (answerDecision)
//   beforeProduction   settle answered/due decisions → apply per-round ongoing effects
//   production         core economy, reads ongoing modifiers
//   afterProduction    fire due follow-ups → roll one global event → roll team events
//
// Nothing in here knows about specific events. Event details stay private to the affected team;
// only outcomes with a `post` template publish a public snippet to match.feed.

import { watch } from 'node:fs';
import path from 'node:path';
import { createRng } from '../game/rng.js';
import { EVENT_ROLLS } from '../game/rules.js';
import { GameError, assertDecisionsOpen, getTeam } from '../game/match.js';
import { EVENTS_FILE, SCHEMA_FILE, loadAndValidateEvents, loadSchema, validateEvents } from './validate.js';
import { checkConditions, failingConditions } from './conditions.js';
import { addOngoing, applyEffects, previewOutcome } from './effects.js';
import { publishPost } from './posts.js';

/** @typedef {import('../game/model.js').Match} Match */
/** @typedef {import('../game/model.js').Team} Team */

export class EventDefinitionError extends Error {
  constructor(errors) {
    super(`Invalid event definitions:\n  ${errors.join('\n  ')}`);
    this.errors = errors;
  }
}

/**
 * @param {object} [options]
 * @param {string} [options.file]    events JSON file (default /data/events.json)
 * @param {object[]} [options.events] inline definitions instead of a file (tests)
 * @param {Partial<typeof EVENT_ROLLS>} [options.rolls] override roll tuning (tests, CLI)
 */
export function createEventEngine({ file = EVENTS_FILE, events, rolls: rollOverrides } = {}) {
  const rolls = { ...EVENT_ROLLS, ...rollOverrides };
  /** @type {Map<string, any>} */
  let definitions = new Map();

  function load() {
    const result = events ? { data: { events }, ...validateEvents({ events }, loadSchema()) } : loadAndValidateEvents(file);
    if (result.errors.length) return { ok: false, errors: result.errors, warnings: result.warnings };
    // Frozen copies: definitions are shared by every team and must never be mutated by outcomes.
    definitions = new Map(
      result.data.events.map((def) => [def.id, deepFreeze({ scope: 'team', enabled: true, ...structuredClone(def) })]),
    );
    return { ok: true, count: definitions.size, errors: [], warnings: result.warnings };
  }

  const initial = load();
  if (!initial.ok) throw new EventDefinitionError(initial.errors);

  const scopeFor = (match) => ({ match, rng: createRng(match), ranks: null });
  const randomPool = (scope) => [...definitions.values()].filter((d) => d.enabled && d.weight > 0 && d.scope === scope);

  // ---- Limits (derived from match.eventHistory) ----------------------------------

  function firingsOf(match, eventId, teamId) {
    return match.eventHistory.filter((h) => h.eventId === eventId && (!teamId || h.teamIds.includes(teamId)));
  }

  function withinMatchLimit(match, def) {
    return !def.maxPerMatch || firingsOf(match, def.id).length < def.maxPerMatch;
  }

  /** Can this event be randomly rolled for this team right now? */
  function eligible(match, def, team, scope) {
    if (def.decision) {
      if (team.pendingDecisions.length >= rolls.maxPendingDecisions) return false;
      if (match.round >= match.config.totalRounds) return false; // no round left to answer in
    }
    const past = firingsOf(match, def.id, team.id);
    if (def.maxPerTeam && past.length >= def.maxPerTeam) return false;
    if (def.cooldownRounds && past.length && match.round - past.at(-1).round <= def.cooldownRounds) return false;
    return checkConditions(def.conditions, team, scope);
  }

  // ---- Firing & outcomes ------------------------------------------------------------

  function applyOutcome(outcome, def, team, scope) {
    const changes = applyEffects(outcome.effects, team, scope);
    if (outcome.ongoing) changes.push(addOngoing(outcome.ongoing, def.id, team));
    if (outcome.followUp) {
      team.scheduledEvents.push({
        eventId: outcome.followUp.event,
        round: scope.match.round + (outcome.followUp.inRounds ?? 1),
        sourceEventId: def.id,
      });
    }
    if (outcome.post) publishPost(scope.match, team, def.id, outcome.post, changes);
    return changes;
  }

  /** Fire an event for the given teams, bypassing eligibility. */
  function fire(match, def, teams, scope, source) {
    const results = teams.map((team) => {
      const changes = applyOutcome(def, def, team, scope);
      let decisionId;
      if (def.decision) {
        decisionId = `d${match.nextDecisionNumber++}`;
        team.pendingDecisions.push({
          instanceId: decisionId,
          eventId: def.id,
          createdRound: match.round,
          dueRound: match.round + 1,
          choice: null,
        });
      }
      team.eventLog.push({
        kind: 'event',
        round: match.round,
        eventId: def.id,
        source,
        title: def.title,
        text: def.text,
        changes,
        ...(decisionId && { decisionId }),
      });
      return { teamId: team.id, changes, decisionId: decisionId ?? null };
    });
    match.eventHistory.push({ round: match.round, eventId: def.id, teamIds: teams.map((t) => t.id), source });
    return results;
  }

  // ---- Resolution steps --------------------------------------------------------------

  /** Apply answered decisions, and timeouts for unanswered ones that are due. */
  function settleDecisions(match) {
    const scope = scopeFor(match);
    for (const team of match.teams) {
      const remaining = [];
      for (const pending of team.pendingDecisions) {
        if (pending.choice == null && match.round < pending.dueRound) {
          remaining.push(pending);
          continue;
        }
        const def = definitions.get(pending.eventId);
        if (!def?.decision) {
          team.eventLog.push({ kind: 'decision', round: match.round, eventId: pending.eventId, title: pending.eventId, text: 'Event was removed; decision dropped.', choice: 'timeout', changes: [] });
          continue;
        }
        const { options, onTimeout } = def.decision;
        // An answer whose requirements no longer hold (e.g. GM edited the budget) counts as no answer.
        const chosen = options.find((o) => o.id === pending.choice && checkConditions(o.requires, team, scope));
        const timeoutOption = onTimeout.option ? options.find((o) => o.id === onTimeout.option) : null;
        const outcome = chosen ?? timeoutOption ?? onTimeout;

        team.eventLog.push({
          kind: 'decision',
          round: match.round,
          eventId: def.id,
          title: def.title,
          text: outcome.result,
          choice: chosen ? chosen.id : 'timeout',
          choiceLabel: chosen ? chosen.label : timeoutOption ? `No answer → ${timeoutOption.label}` : 'No answer',
          changes: applyOutcome(outcome, def, team, scope),
        });
      }
      team.pendingDecisions = remaining;
    }
  }

  function applyOngoingEffects(match) {
    const scope = scopeFor(match);
    for (const team of match.teams) {
      for (const effect of team.activeEffects) {
        if (!effect.perRound) continue;
        const changes = applyEffects(effect.perRound, team, scope);
        if (changes.length) {
          team.eventLog.push({ kind: 'ongoing', round: match.round, eventId: effect.sourceEventId, title: effect.label, changes });
        }
      }
    }
  }

  function rollEvents(match) {
    const scope = scopeFor(match);
    const { rng } = scope;
    const gotFollowUp = new Set();

    // 1. Guaranteed follow-ups
    for (const team of match.teams) {
      const due = team.scheduledEvents.filter((s) => s.round <= match.round);
      if (!due.length) continue;
      team.scheduledEvents = team.scheduledEvents.filter((s) => s.round > match.round);
      for (const scheduled of due) {
        const def = definitions.get(scheduled.eventId);
        if (!def) continue;
        fire(match, def, [team], scope, 'followUp');
        gotFollowUp.add(team.id);
      }
    }

    if (match.round < rolls.firstRound) return;

    // 2. At most one global event, hitting every team that matches its conditions
    if (rng.chance(rolls.globalEventChance)) {
      const candidates = randomPool('global')
        .filter((def) => withinMatchLimit(match, def))
        .map((def) => ({ def, teams: match.teams.filter((t) => eligible(match, def, t, scope)) }))
        .filter((c) => c.teams.length > 0);
      const pick = rng.weighted(candidates, (c) => c.def.weight);
      if (pick) fire(match, pick.def, pick.teams, scope, 'random');
    }

    // 3. Team events
    for (const team of match.teams) {
      if (gotFollowUp.has(team.id) && !rolls.rollAfterFollowUp) continue;
      if (!rng.chance(rolls.teamEventChance)) continue;
      const candidates = randomPool('team').filter((def) => withinMatchLimit(match, def) && eligible(match, def, team, scope));
      const def = rng.weighted(candidates, (d) => d.weight);
      if (def) fire(match, def, [team], scope, 'random');
    }
  }

  // ---- Public API -----------------------------------------------------------------------

  return {
    /** Pass to resolveRound(match, engine.hooks). */
    hooks: {
      beforeProduction(match) {
        settleDecisions(match);
        applyOngoingEffects(match);
      },
      afterProduction: rollEvents,
    },

    /** Re-read the events file. On failure the previous definitions stay active. */
    reload() {
      return load();
    },

    /**
     * Watch the data directory and reload on change. Returns a function that stops watching.
     * @param {(result: ReturnType<typeof load>) => void} onReload
     */
    watch(onReload) {
      if (events) throw new Error('Inline event definitions cannot be watched');
      const names = new Set([path.basename(file), path.basename(SCHEMA_FILE)]);
      let timer;
      const watcher = watch(path.dirname(file), (_type, name) => {
        if (name && !names.has(name)) return;
        clearTimeout(timer);
        timer = setTimeout(() => onReload(load()), 150); // editors write in bursts
      });
      return () => {
        clearTimeout(timer);
        watcher.close();
      };
    },

    get(eventId) {
      return definitions.get(eventId);
    },

    list() {
      return [...definitions.values()];
    },

    /** Team-scope events that could be rolled for this team right now, with their odds. */
    eligibleFor(match, teamId) {
      const team = getTeam(match, teamId);
      const scope = scopeFor(match);
      const candidates = randomPool('team').filter((def) => withinMatchLimit(match, def) && eligible(match, def, team, scope));
      const total = candidates.reduce((sum, d) => sum + d.weight, 0);
      return candidates.map((d) => ({ id: d.id, title: d.title, weight: d.weight, share: d.weight / total }));
    },

    /** Why an event is or isn't currently eligible for a team (for the GM view and CLI). */
    explain(match, eventId, teamId) {
      const def = definitions.get(eventId);
      if (!def) throw new GameError('unknown_event', `No event with id "${eventId}"`);
      const team = getTeam(match, teamId);
      const scope = scopeFor(match);
      const reasons = failingConditions(def.conditions, team, scope);
      if (!def.enabled) reasons.push('disabled');
      if (def.weight === 0) reasons.push('weight is 0');
      if (!withinMatchLimit(match, def)) reasons.push(`already fired ${def.maxPerMatch}× this match`);
      const past = firingsOf(match, def.id, team.id);
      if (def.maxPerTeam && past.length >= def.maxPerTeam) reasons.push(`team already had it ${def.maxPerTeam}×`);
      if (def.cooldownRounds && past.length && match.round - past.at(-1).round <= def.cooldownRounds) reasons.push('on cooldown');
      if (def.decision && team.pendingDecisions.length >= rolls.maxPendingDecisions) reasons.push('team has a pending decision');
      return { eligible: reasons.length === 0, reasons };
    },

    /**
     * GM manual trigger. Ignores weight, limits and the pending-decision cap.
     * @param {{ teamIds?: string[], respectConditions?: boolean }} [options]
     *   teamIds defaults to every team for global events; required for team events.
     */
    trigger(match, eventId, { teamIds, respectConditions = false } = {}) {
      if (match.status === 'ended') throw new GameError('match_ended', 'Match has ended');
      const def = definitions.get(eventId);
      if (!def) throw new GameError('unknown_event', `No event with id "${eventId}"`);
      let teams;
      if (teamIds?.length) teams = teamIds.map((id) => getTeam(match, id));
      else if (def.scope === 'global') teams = match.teams;
      else throw new GameError('teams_required', 'Choose at least one team for a team event');

      const scope = scopeFor(match);
      if (respectConditions) teams = teams.filter((t) => checkConditions(def.conditions, t, scope));
      if (!teams.length) throw new GameError('no_matching_teams', 'No selected team matches the event conditions');
      return fire(match, def, teams, scope, 'gm');
    },

    /** Record (or change) a team's answer. Applied at the start of the next resolution. */
    answerDecision(match, teamId, instanceId, optionId) {
      assertDecisionsOpen(match);
      const team = getTeam(match, teamId);
      const pending = team.pendingDecisions.find((p) => p.instanceId === instanceId);
      if (!pending) throw new GameError('unknown_decision', 'That decision is no longer pending');
      const option = definitions.get(pending.eventId)?.decision?.options.find((o) => o.id === optionId);
      if (!option) throw new GameError('unknown_option', `No option "${optionId}"`);
      const failing = failingConditions(option.requires, team, scopeFor(match));
      if (failing.length) throw new GameError('option_unavailable', `Requires ${failing.join(' and ')}`);
      pending.choice = optionId;
      return pending;
    },

    /** Pending decisions as the team client should see them (respects hideEffects). */
    decisionsView(match, teamId) {
      const team = getTeam(match, teamId);
      const scope = scopeFor(match);
      return team.pendingDecisions.flatMap((pending) => {
        const def = definitions.get(pending.eventId);
        if (!def?.decision) return [];
        const { prompt, options, onTimeout, hideEffects = false } = def.decision;
        return [
          {
            instanceId: pending.instanceId,
            eventId: def.id,
            title: def.title,
            text: def.text,
            prompt,
            dueRound: pending.dueRound,
            choice: pending.choice,
            options: options.map((option) => {
              const hidden = option.hideEffects ?? hideEffects;
              const failing = failingConditions(option.requires, team, scope);
              return {
                id: option.id,
                label: option.label,
                description: option.description ?? null,
                available: failing.length === 0,
                unavailableReason: failing.length ? `Requires ${failing.join(' and ')}` : null,
                effectsHidden: hidden,
                preview: hidden ? null : previewOutcome(option, team, scope),
              };
            }),
            onTimeout: onTimeout.option
              ? { option: onTimeout.option, preview: null }
              : { option: null, preview: hideEffects ? null : previewOutcome(onTimeout, team, scope) },
          },
        ];
      });
    },

    /** Exposed for tests and tooling; the hooks call these in order. */
    steps: { settleDecisions, applyOngoingEffects, rollEvents },
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
