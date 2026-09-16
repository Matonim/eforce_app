// Phase loop: drives a running match through its rounds on a timer.
//
//   decision (decisionSeconds) ──timer or GM advance──▶ resolveRound ──▶ resolution (resolutionSeconds)
//        ▲                                                                        │
//        └──────────────── advanceRound (next round) ◀──timer or GM advance──────┘   … ▶ ended
//
// The match stays pure JSON: it only stores `phaseEndsAt` / `pausedRemainingMs`. This module owns the
// single timer and always derives it from those fields, so a match restored from a snapshot can be
// picked up with sync(). Every transition calls onChange() so clients get fresh state.
//
// A timer callback must never crash the process mid-workshop: if a transition throws, the match is
// paused on the results screen and the error is reported to the GM (status().lastError).

import {
  GameError,
  adjustPhaseTime,
  advanceRound,
  endMatch,
  pauseMatch,
  resetMatch,
  resolveRound,
  resumeMatch,
  startMatch,
  startPhaseTimer,
} from './game/match.js';

const systemClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

// Timers may fire a few ms early; anything later than this counts as "not due yet" and re-arms.
const EARLY_TOLERANCE_MS = 25;

/**
 * @param {object} options
 * @param {import('./game/model.js').Match} options.match
 * @param {{ hooks: object }} options.engine
 * @param {() => void} [options.onChange]
 * @param {{ now(): number, setTimeout(fn: () => void, ms: number): any, clearTimeout(handle: any): void }} [options.clock]
 * @param {Pick<Console, 'info' | 'error'>} [options.log]
 */
export function createPhaseLoop({ match, engine, onChange = () => {}, clock = systemClock, log = console }) {
  let timer = null;
  let generation = 0; // invalidates timers that were armed before a GM action
  let lastError = null;

  function clearTimer() {
    generation += 1;
    if (timer != null) clock.clearTimeout(timer);
    timer = null;
  }

  /** (Re)schedule the timer for the current phase end, if the match is running. */
  function arm() {
    clearTimer();
    if (match.status !== 'running' || match.phaseEndsAt == null) return;
    const armedFor = generation;
    timer = clock.setTimeout(() => onTimer(armedFor), Math.max(0, match.phaseEndsAt - clock.now()));
  }

  function onTimer(armedFor) {
    if (armedFor !== generation) return;
    timer = null;
    if (match.status !== 'running' || match.phaseEndsAt == null) return;
    if (match.phaseEndsAt - clock.now() > EARLY_TOLERANCE_MS) return arm();
    guarded(() => (match.phase === 'decision' ? toResolution() : toNextRound()), { fromTimer: true });
    onChange();
  }

  function toDecision() {
    startPhaseTimer(match, clock.now());
    log.info(`[phase] round ${match.round}/${match.config.totalRounds}: decision (${match.config.decisionSeconds}s)`);
    arm();
  }

  function toResolution() {
    clearTimer();
    resolveRound(match, engine.hooks);
    startPhaseTimer(match, clock.now());
    log.info(`[phase] round ${match.round}/${match.config.totalRounds}: resolution (${match.config.resolutionSeconds}s)`);
    arm();
  }

  function toNextRound() {
    clearTimer();
    const { ended } = advanceRound(match);
    if (ended) log.info('[phase] match ended');
    else toDecision();
  }

  /**
   * Run a transition; on an unexpected error pause on the results screen instead of crashing.
   * GameErrors are invalid GM requests and go back to the caller, except inside a timer callback,
   * where nothing may throw.
   */
  function guarded(transition, { fromTimer = false } = {}) {
    try {
      transition();
    } catch (err) {
      if (err instanceof GameError && !fromTimer) throw err;
      clearTimer();
      lastError = `${new Date(clock.now()).toISOString()} round ${match.round} ${match.phase}: ${err.message}`;
      log.error(`[phase] transition failed, match paused: ${err.stack ?? err}`);
      if (match.status === 'running') {
        match.status = 'paused';
        match.phaseEndsAt = null;
        match.pausedRemainingMs = Math.round(match.config.resolutionSeconds * 1000);
      }
    }
  }

  /** GM actions: run, then notify. GameErrors (invalid requests) propagate to the caller. */
  function act(fn) {
    guarded(fn);
    onChange();
  }

  return {
    start() {
      act(() => {
        startMatch(match);
        toDecision();
      });
    },

    pause() {
      act(() => {
        pauseMatch(match, clock.now());
        clearTimer();
      });
    },

    resume() {
      act(() => {
        resumeMatch(match, clock.now());
        arm();
      });
    },

    /** Skip the rest of the current phase. Also un-pauses a paused match. */
    advance() {
      act(() => {
        if (match.status === 'paused') resumeMatch(match, clock.now());
        if (match.status !== 'running') throw new GameError('not_running', 'The match is not running');
        if (match.phase === 'decision') toResolution();
        else toNextRound();
      });
    },

    /** Add (or with a negative number, remove) seconds from the current phase. */
    addTime(seconds) {
      act(() => {
        adjustPhaseTime(match, seconds, clock.now());
        arm();
      });
    },

    end() {
      act(() => {
        clearTimer();
        endMatch(match);
        log.info('[phase] match ended by GM');
      });
    },

    reset(options) {
      act(() => {
        clearTimer();
        resetMatch(match, options);
        lastError = null;
      });
    },

    /** Re-arm from the match's own timing fields, e.g. after restoring a snapshot. */
    sync() {
      arm();
    },

    /** Stop the timer without touching the match (server shutdown). */
    stop() {
      clearTimer();
    },

    /** lastError stays visible to the GM until the match is reset. */
    status() {
      return { timerArmed: timer != null, lastError };
    },
  };
}
