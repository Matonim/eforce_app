// Data model reference (JSDoc only). Everything here is plain JSON-serializable data:
// a match can be written to disk with JSON.stringify and restored with JSON.parse.

/**
 * @typedef {'lobby' | 'running' | 'paused' | 'ended'} MatchStatus
 * @typedef {'lobby' | 'decision' | 'resolution' | 'ended'} Phase
 *
 * @typedef {object} MatchConfig
 * @property {string} seed
 * @property {number} totalRounds
 * @property {number} decisionSeconds
 * @property {number} resolutionSeconds
 * @property {number} maxTeams
 *
 * @typedef {object} Match
 * @property {string} id
 * @property {MatchStatus} status
 * @property {Phase} phase
 * @property {number} round              0 in lobby, 1..totalRounds while running
 * @property {number|null} phaseEndsAt   epoch ms when the current phase times out
 * @property {number|null} pausedRemainingMs  time left in the phase when paused
 * @property {MatchConfig} config
 * @property {number} rngState           seeded RNG state, advances with every roll
 * @property {number} nextTeamNumber
 * @property {number} nextDecisionNumber
 * @property {number} nextPostNumber
 * @property {Team[]} teams
 * @property {EventFiring[]} eventHistory  every event that fired; drives maxPerTeam/maxPerMatch/cooldown
 * @property {FeedPost[]} feed           public social-media snippets, visible to every role
 * @property {Race|null} race            the end-of-season competition, once the GM starts it
 *
 * @typedef {object} Race
 * @property {'revealing' | 'finished'} status
 * @property {number} step               how far the GM has revealed (index into steps)
 * @property {{id: string, name: string, type: string, points: number, unit: string|null, blurb: string}[]} disciplines
 * @property {Record<string, {rows: object[]}>} results  per discipline, every team's row
 * @property {object[]} steps            the reveal timeline (intro, statics, dynamics, laps, totals, podium)
 * @property {{place: number, teamId: string, total: number, byDiscipline: Record<string, number>}[]} totals
 *
 * @typedef {object} FeedPost
 * @property {string} id
 * @property {number} round
 * @property {string|null} teamId        the team the post is about; null for a GM announcement
 * @property {string|null} eventId
 * @property {'event' | 'gm'} source
 * @property {string} text               rendered from the event's "post" template, or the GM's own words
 *
 * @typedef {object} EventFiring
 * @property {number} round
 * @property {string} eventId
 * @property {string[]} teamIds
 * @property {'random' | 'followUp' | 'gm'} source
 *
 * @typedef {object} Location
 * @property {string} id
 * @property {string} name
 * @property {string} country            ISO 3166 alpha-2
 *
 * @typedef {object} Team
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {Location} location
 * @property {number} budget             integer euros, may go negative (debt)
 * @property {{ budget: number, stats: {performance: number, reliability: number} }} start  values at join, for "change since" displays
 * @property {Record<string, number>} personnel  department → headcount
 * @property {{performance: number, reliability: number}} focus  sums to 100
 * @property {{performance: number, reliability: number}} stats  0..100
 * @property {boolean} autonomous        driverless programme running (unlocks the DV disciplines)
 * @property {Record<string, boolean|number|string>} flags  set by events, read by event conditions
 * @property {ActiveEffect[]} activeEffects
 * @property {PendingDecision[]} pendingDecisions
 * @property {ScheduledEvent[]} scheduledEvents  guaranteed follow-ups (hidden from the team)
 * @property {LogEntry[]} eventLog
 * @property {RoundReport[]} history     one entry per resolved round
 *
 * @typedef {object} ActiveEffect
 * @property {string} id                 defaults to the source event id; re-applying refreshes duration
 * @property {string} sourceEventId
 * @property {string} label
 * @property {number} roundsLeft
 * @property {Record<string, any>} [perRound]   effects applied every resolution
 * @property {Record<string, number>} [modifiers] multipliers, e.g. { "output.aero": 0.5 }
 *
 * @typedef {object} PendingDecision
 * @property {string} instanceId
 * @property {string} eventId
 * @property {number} createdRound
 * @property {number} dueRound           settled by timeout at this round's resolution if unanswered
 * @property {string|null} choice        option id picked so far (can change until resolution)
 *
 * @typedef {object} ScheduledEvent
 * @property {string} eventId
 * @property {number} round              fires at the end of this round's resolution
 * @property {string} sourceEventId
 *
 * @typedef {object} Change
 * @property {string} path               resolved path, e.g. "personnel.aero" (never "@largest")
 * @property {any} from
 * @property {any} to
 * @property {string} [label]            ongoing effects: their label
 *
 * @typedef {object} LogEntry
 * @property {'event' | 'decision' | 'ongoing' | 'gm' | 'programme'} kind
 * @property {number} round
 * @property {string} eventId
 * @property {string} title
 * @property {string} [text]
 * @property {'random' | 'followUp' | 'gm'} [source]  kind "event" only
 * @property {string} [decisionId]       kind "event": the pending decision it created
 * @property {string} [choice]           kind "decision": option id, or "timeout"
 * @property {string} [choiceLabel]
 * @property {Change[]} changes
 *
 * @typedef {object} RoundReport
 * @property {number} round
 * @property {{performance: number, reliability: number}} gains
 * @property {number} income
 * @property {number} upkeep
 * @property {{performance: number, reliability: number}} stats  after the round
 * @property {number} budget             after the round
 * @property {number} score              after the round
 */

export {};
