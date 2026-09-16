// What each role is allowed to see. Every payload the server sends is built here, so the
// privacy rules live in one place:
//
//   guest      match status + team names (for the join screen)
//   team       its own full state, other teams' public identity only, the public feed
//   spectator  match status, public team identities, the public feed
//   gm         everything
//
// Final standings (race points and stats of every team) are public once the competition is finished.
// Season scores are for the GM only.

import {
  AUTONOMOUS,
  DEPARTMENTS,
  DEPARTMENT_INFO,
  ECONOMY,
  FOCUS_MULTIPLIER,
  STAT_LIMITS,
  VISIBILITY,
  computeScore,
} from '../game/rules.js';
import { getTeam, headcount, projectProduction } from '../game/match.js';
import { previewOutcome } from '../events/effects.js';

export const FEED_LIMIT = 50;

/**
 * The rules a team needs to plan. Static. What each department actually produces (with diminishing
 * returns, focus and the team's location) is in `me.projection.departments`.
 */
const TEAM_RULES = {
  departments: DEPARTMENTS.map((id) => ({
    id,
    label: DEPARTMENT_INFO[id]?.label ?? id,
    description: DEPARTMENT_INFO[id]?.description ?? '',
  })),
  economy: { ...ECONOMY },
  focusMultiplier: { ...FOCUS_MULTIPLIER },
  statLimits: structuredClone(STAT_LIMITS),
  autonomous: { ...AUTONOMOUS },
};

/**
 * The competition as a role may see it. Teams and the spectator screen only get the steps the GM
 * has revealed so far — the rest of the results stay on the server until they're announced.
 */
function raceView(match, { full = false } = {}) {
  const race = match.race;
  if (!race) return null;
  return {
    status: race.status,
    step: race.step,
    totalSteps: race.steps.length,
    disciplines: race.disciplines,
    steps: full ? race.steps : race.steps.slice(0, race.step + 1),
    totals: full || race.status === 'finished' ? race.totals : null,
  };
}

function matchInfo(match) {
  const { id, status, phase, round, phaseEndsAt, pausedRemainingMs, config } = match;
  return {
    id,
    status,
    phase,
    round,
    totalRounds: config.totalRounds,
    decisionSeconds: config.decisionSeconds,
    resolutionSeconds: config.resolutionSeconds,
    maxTeams: config.maxTeams,
    phaseEndsAt,
    pausedRemainingMs,
  };
}

const publicTeam = (team) => ({ id: team.id, name: team.name, color: team.color, location: { ...team.location } });

/**
 * Final standings. Teams and the projector only get them once the competition is finished (the
 * race points are the result that counts, and season scores are never shown to players). The GM
 * also gets season standings as soon as the season ends.
 */
function standings(match, { includeSeason = false } = {}) {
  if (match.status !== 'ended') return null;
  if (match.race?.status !== 'finished' && !includeSeason) return null;
  const byId = new Map(match.teams.map((t) => [t.id, t]));

  if (match.race?.status === 'finished') {
    return match.race.totals.map((row) => {
      const team = byId.get(row.teamId);
      return {
        place: row.place,
        teamId: row.teamId,
        name: team.name,
        color: team.color,
        score: row.total,
        source: 'race',
        performance: team.stats.performance,
        reliability: team.stats.reliability,
        budget: team.budget,
      };
    });
  }

  return match.teams
    .map((t) => ({
      teamId: t.id,
      name: t.name,
      color: t.color,
      score: computeScore(t),
      source: 'season',
      performance: t.stats.performance,
      reliability: t.stats.reliability,
      budget: t.budget,
    }))
    .sort((a, b) => b.score - a.score)
    .map((row, i) => ({ place: i + 1, ...row }));
}

function publicPart(match) {
  return {
    serverTime: Date.now(),
    match: matchInfo(match),
    teams: match.teams.map(publicTeam),
    feed: match.feed.slice(-FEED_LIMIT),
    standings: standings(match),
    race: raceView(match),
  };
}

export function guestView(match) {
  return {
    role: 'guest',
    serverTime: Date.now(),
    match: matchInfo(match),
    teams: match.teams.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    joinable: match.status === 'lobby' && match.teams.length < match.config.maxTeams,
  };
}

export function spectatorView(match) {
  return { role: 'spectator', ...publicPart(match) };
}

/**
 * @param {{ showOwnScore?: boolean }} [options] defaults to VISIBILITY.ownScoreDuringMatch. The
 *   season score is never revealed to a team otherwise: the competition's points are what count.
 */
export function teamView(match, engine, teamId, { showOwnScore = VISIBILITY.ownScoreDuringMatch } = {}) {
  const team = getTeam(match, teamId);
  const scope = { match, rng: null, ranks: null };
  const scoreVisible = showOwnScore;
  const start = team.start ?? { budget: team.budget, stats: team.stats };
  const { stats: _projectedStats, ...projection } = projectProduction(team, match);
  return {
    role: 'team',
    ...publicPart(match),
    rules: TEAM_RULES,
    me: {
      id: team.id,
      name: team.name,
      color: team.color,
      location: { ...team.location },
      budget: team.budget,
      personnel: { ...team.personnel },
      headcount: headcount(team),
      focus: { ...team.focus },
      stats: { ...team.stats },
      autonomous: Boolean(team.autonomous),
      score: scoreVisible ? computeScore(team) : null,
      start: {
        budget: start.budget,
        stats: { ...start.stats },
        score: scoreVisible ? computeScore(start) : null,
      },
      // This round's production with the current staff and focus (before random events).
      projection,
      activeEffects: team.activeEffects.map((e) => ({
        id: e.id,
        label: e.label,
        roundsLeft: e.roundsLeft,
        perRound: e.perRound ? previewOutcome({ effects: e.perRound }, team, scope).effects : [],
        modifiers: e.modifiers ?? null,
      })),
      decisions: engine.decisionsView(match, team.id),
      // Flags and follow-up scheduling are designer internals; `source` would reveal follow-ups.
      eventLog: team.eventLog.map(({ source, ...entry }) => ({
        ...entry,
        changes: entry.changes.filter((c) => !c.path.startsWith('flags.')),
      })),
      history: scoreVisible ? team.history : team.history.map(({ score, ...report }) => ({ ...report, score: null })),
    },
  };
}

export function gmView(match, engine, { online, events, loop }) {
  return {
    role: 'gm',
    serverTime: Date.now(),
    match: structuredClone(match),
    rules: TEAM_RULES,
    // Scores are computed here so the GM screen never reimplements the scoring formula.
    scores: Object.fromEntries(match.teams.map((t) => [t.id, computeScore(t)])),
    standings: standings(match, { includeSeason: true }),
    race: raceView(match, { full: true }),
    loop,
    online,
    events: {
      ...events,
      definitions: engine.list().map((d) => ({
        id: d.id,
        title: d.title,
        scope: d.scope,
        weight: d.weight,
        enabled: d.enabled,
        tags: d.tags ?? [],
        hasDecision: Boolean(d.decision),
      })),
    },
  };
}
