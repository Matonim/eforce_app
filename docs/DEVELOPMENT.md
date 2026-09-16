# Development

- [Setup](#setup)
- [Scripts](#scripts)
- [CLI tools](#cli-tools)
- [Tests](#tests)
- [Conventions](#conventions)
- [Extending the engine](#extending-the-engine)
- [Documentation](#documentation)
- [Troubleshooting](#troubleshooting)

---

## Setup

- Node.js 22+ (developed on 26.7). No other system dependencies.
- npm workspaces: `server/` and `client/` are installed together from the root.

```bash
npm install
```

Create `.env` in the repo root with the two passwords. It's git-ignored; `.env.example` shows the format.

```bash
cp .env.example .env
```

```bash
npm run dev
```

| URL | What |
|---|---|
| `http://localhost:5173/` | team client (Vite dev server) |
| `http://localhost:5173/gm` | GM dashboard (GM password) |
| `http://localhost:5173/screen` | spectator / projector screen (spectator password) |
| `http://localhost:3000/api/health` | server health JSON |

### Playing several teams on one computer

A browser keeps one team session per site, so every tab of `http://localhost:5173/` shows the same team. To test with several teams from one Mac, give each tab its own **slot** in the URL:

| Tab | URL |
|---|---|
| Team 1 | `http://localhost:5173/?slot=1` |
| Team 2 | `http://localhost:5173/?slot=2` |
| Team 3 | `http://localhost:5173/?slot=3` |

Each slot stores its own session token (`eforce.token.team.<slot>` in `localStorage`), so the tabs are separate teams and each one survives a refresh. The slot is shown next to the location in the team header. Slot names can be letters, numbers, `-` or `_` (up to 20 characters). The GM and projector pages accept `?slot=` too, but they don't need it.

Without `?slot=`, the page behaves exactly as it does on a participant's own device. Other ways to get a separate session: a different browser, a private window, or a different address for the same server (`localhost`, `127.0.0.1` and the LAN address each count as a different site).

### Environment variables

Set these in `.env` (repo root) or in the real environment; the real environment wins.

| Variable | Default | Used by |
|---|---|---|
| `GM_PASSWORD` | **required** | server: `/gm` login |
| `SPECTATOR_PASSWORD` | **required** | server: `/screen` login |
| `SERVER_PORT` | `3000` | server port; the Vite dev proxy reads it too |
| `SEED` | `workshop` | server: RNG seed for the match |
| `NODE_ENV` | | `npm start` sets `production` |

Don't use `node --env-file` for the server. Why this matters, and why it's `SERVER_PORT` rather than `PORT`: [ARCHITECTURE.md → config.js](ARCHITECTURE.md#configjs-and-indexjs).

---

## Scripts

Run these from the repo root. **Put extra arguments after `--`**, e.g. `npm run sim:events -- --try=local_sponsor`.

| Script | Description |
|---|---|
| `npm run dev` | server (`node --watch-path=src`) + Vite, together |
| `npm run build` | build the client to `client/dist` |
| `npm start` | production server; serves `client/dist` |
| `npm test` | server suites, then the client ones |
| `npm run events:check -- [file]` | validate an events file (default `data/events.json`) |
| `npm run sim:events -- [flags]` | event engine simulator; see below |
| `npm run sim:state -- [flags]` | core economy simulator, no events |
| `npm run sim:race -- [flags]` | plays seasons and runs the competition; balance table per discipline |

---

## CLI tools

### `events:check`

```bash
npm run events:check
```

```bash
npm run events:check -- path/to/other-events.json
```

Prints errors (✗, exit code 1) and warnings (⚠), followed by a summary like `✓ 11 events valid — 9 team, 2 global, 2 with decisions, 0 disabled`. The messages are explained in [EVENTS.md → Validation messages](EVENTS.md#validation-messages).

### `sim:events`

| Mode | Command | Output |
|---|---|---|
| Match feed | `npm run sim:events` | Round-by-round log of every event, decision and ongoing tick; final standings; checks that a rerun with the same seed matches |
| Try one event | `npm run sim:events -- --try=<id>` | Fires the event on a sample team (random rolls off), prints the decision as the team sees it (including locked options and hidden effects), then plays out every option and the timeout until nothing is pending |
| Statistics | `npm run sim:events -- --matches=300` | Per event: fires per match, hits per team, % of matches; decision outcome counts; final score spread |

| Flag | Default | Applies to |
|---|---|---|
| `--seed=<text>` | `workshop` | all modes (stats uses `<seed>-0` … `<seed>-N`) |
| `--teams=<n>` | 10 | feed, stats |
| `--rounds=<n>` | 14 (`MATCH_DEFAULTS.totalRounds`) | feed, stats |

Fake players reassign staff and change focus randomly (60% chance each round), answer 75% of decisions with a random available option, and let the rest time out. Their RNG is separate from the match RNG.

Legend: `⚡` random event · `↪` follow-up · `✋` GM trigger · `✔` decision settled · `⟳` ongoing effect · `📣` public feed post.

### `sim:race`

```bash
npm run sim:race -- --matches=100 --teams=10 --rounds=14 --autonomy=0.4
```

Plays whole seasons with fake teams (some of them running a driverless programme once they can afford twice the setup fee), then runs the competition and prints a table: average points and share per discipline, the winning time's average and range against the typical time, the endurance retirement rate, how often driverless teams win, and the winning total. Use `--show` to print one season's race discipline by discipline instead.

### `sim:state`

```bash
npm run sim:state -- --seed=abc --rounds=10 --teams=8 --quiet
```

Runs the core economy without events (14 rounds unless `--rounds` is given). It checks that the same seed reproduces the same match, and that a JSON snapshot taken halfway through continues identically.

---

## Tests

```
server/test/engine.test.js     event engine (pure, no network)
server/test/sockets.test.js    socket protocol against a real in-process server
server/test/phases.test.js     phase loop with a fake clock, plus one real-timer socket run
server/test/views.test.js      per-role payloads: forecast, rules, score visibility
server/test/race.test.js       the competition: points, times, DNFs, the driverless programme
client/src/lib/format.test.js  effect/change/modifier wording
```

Uses the built-in `node:test` runner; the only test dependency is `socket.io-client`. `npm test` runs the server suites and then the client ones — 59 tests.

### `engine.test.js`

| Area | What is checked |
|---|---|
| Conditions | every operator, `any`/`not`, unset flags, `active.*`, `rank.*` |
| Effects | add, range, `per`, multiply, set, clamping, `@largest`, flag counters, frozen definitions |
| Ongoing | per-round effects each resolution, expiry, refresh instead of stacking, modifiers change production |
| Decisions | applied at the next resolution, `requires` enforced, timeout at due round, closed outside the decision phase |
| `hideEffects` | decision-level setting, per-option override, timeout preview |
| Follow-ups | exact round, ignores weight/conditions/limits/`enabled`, scheduling from options |
| Rolls | conditions, `maxPerTeam`, cooldown, pending-decision limit, global subset + `maxPerMatch` |
| Posts | placeholders render, one post per outcome, option and custom-timeout posts, unknown placeholders rejected, `{change.x}` warning |
| Determinism | two identical runs produce identical JSON |
| Loading | the real `events.json` is valid; invalid definitions throw readable errors |

Helpers: `setup({ events, teams, rolls, totalRounds })` (started match with fixed budgets, staffing and stats, plus an engine built from inline events), `ev({...})` (minimal valid event), `NO_ROLLS` (only GM triggers and follow-ups fire), `playRound(match, engine)` (resolves the round, then advances).

### `sockets.test.js`

It starts `createGameServer()` on a random local port with test passwords and inline events. The tests run **in order against one server**: lobby → join → start → in-match → end → reset → lockout.

| Area | What is checked |
|---|---|
| Joining | guest state, empty/duplicate names rejected, team state after join |
| Sessions | reconnect with token restores the team or GM; unknown token → `session:invalid`; leaving revokes the token |
| Auth | GM requests from guests or teams → `forbidden`; wrong passwords; `already_authenticated`; lockout (runs last, because it locks `127.0.0.1`) |
| Late joins | rejected once the match runs; `joinable: false` |
| Privacy | event log only for the affected team; flags and `source` stripped; other teams and the spectator get exactly `{ id, name, color, location }`; no `scheduledEvents`, `flags` or tokens in any team/spectator payload; no standings during the match |
| Feed | a GM-triggered event's rendered post reaches teams and the spectator |
| Decisions | allocation validation, focus, answering and resolution through the socket |
| End/reset | standings public after the end; reset without teams ends team sessions |
| GM fixes | budget edit validated (whole number, budget only, role checked) and logged for the team; Race Control posts reach teams with `teamId: null`; `gm:explain` answers per team |

Helpers: `client(token?)` connects and resolves on the first `state` (the latest is kept in `socket.state`), `request(socket, event, payload)` wraps `emitWithAck`, and `until(socket, predicate)` waits for a matching state.

### `phases.test.js`

| Area | What is checked |
|---|---|
| Timing | decision → resolution → next round at exactly the configured durations; one timer at a time; a whole match runs to the end with no timers left |
| Pause | remaining time kept in both phases; nothing happens while paused; resume continues |
| Advance | skips the current phase; resumes a paused match; the cancelled timer never resolves a round twice; advancing past the last results ends the match |
| Add time | extends the running timer, clamps at 1 s, adjusts a paused phase, rejects 0 and fractions |
| End / reset | timers cleared, nothing fires afterwards |
| Crash safety | an exception in an event hook during a timed transition pauses the match with `lastError`, and resume continues |
| Snapshot | `sync()` re-arms a loop from a JSON-restored match |
| Settings | `configureMatch` limits, whole numbers, lobby only |
| Sockets | with sub-second phases: timers alone move clients through round 1 → results → round 2; pause, add time, advance while paused, end; `gm:configure` validation and role check |

`fakeClock()` in the file gives `now`/`setTimeout`/`clearTimeout` plus `tick(ms)`, which runs due timers in order. The stale-timer and crash-safety tests were confirmed by removing those safeguards from `phases.js` and seeing the tests fail.

### `views.test.js` and `format.test.js`

`views.test.js` checks that `me.projection` is exactly what the round then produces, that the per-department breakdown adds up to the forecast and one more person always adds something, that the team payload carries the department labels and starting values, and that the season score never reaches a team: not in `me`, `start` or `history`, and no `standings` until the competition is over.

### `race.test.js`

| Area | What is checked |
|---|---|
| Points | the ten disciplines total 1000, each one's best team takes full points, totals are the sum of the parts |
| Times | every timed discipline is won within the day's variation of its typical time, nobody is far beyond the cutoff, and over 12 competitions the winning times really vary (sometimes faster, sometimes slower than typical) |
| Timing board | after every endurance lap: running cars ordered by total time, correct gaps, best lap never slower than the last one, retired cars without a gap, and the fastest lap matching the best of the field |
| Driverless | teams without the programme are `not-entered` and score 0 in both DV disciplines |
| Statics | the top four go to a finals round, and the reveal shows the rest first |
| Endurance | 18 lap steps, retirements announced on the right lap with a reason from the rules, no efficiency score without a finish. Failure is random, so the shape is checked over 40 seeds rather than one |
| Reproducibility | the same finished season always produces the same race |
| Programme | setup fee, running cost (× the location's cost level, and the same amount the team screen shows before starting), sponsor bonus, autonomy only growing while it runs, department locked until it starts, and stopping blocked while staffed |

`format.test.js` (client) pins the wording of effect previews, logged changes and modifiers: signs, the real minus sign, euro amounts, ranges, `per` estimates, percentages, and that higher running costs read as a bad change.

---

## Conventions

- **Plain JavaScript (ES modules)**, with JSDoc typedefs where they help. No build step on the server.
- **Keep game state pure.** Functions in `match.js` and `events/` change the match passed in and throw `GameError(code, message)`. They don't use timers, sockets, `Date.now()` (except the explicit `now` parameters) or console output.
- **Never use `Math.random()` in game code.** Use `createRng(match)` so results can be reproduced.
- **Everything in the match must survive `JSON.stringify`**: no class instances, Maps, functions or timers.
- **Tuning numbers only live in `rules.js`.** Event content only lives in `data/events.json`. No event-specific code anywhere.
- **Every payload sent to clients is built in `net/views.js`.** Never `emit` match data from anywhere else, or the privacy rules get bypassed.
- **Timers only live in `phases.js`.** Match lifecycle changes from sockets go through the loop (`loop.start()`, `loop.pause()`, …), never straight to `match.js`, or the timer and the match get out of sync.
- **Secrets never go in the match**: session tokens and passwords stay in `net/auth.js` and config.
- **Client:** functional React components, plain CSS with the variables in `styles.css`, and all server traffic through `useGame()`. Layouts are built for tablets and laptops and stack into one column on phones; touch targets stay at least 48 px.
- **The client never reimplements game rules.** Department names, contributions, costs and the round forecast all come from the server payload (`state.rules`, `me.projection`).
- **All number and effect wording lives in `lib/format.js`**, so the same effect reads the same way everywhere. Direction is always carried by a sign or an arrow as well as color.

---

## Extending the engine

Most content changes only need `events.json`. These checklists are for when the *vocabulary* has to grow.

### Adding a department

1. `server/src/game/rules.js`: add it to `DEPARTMENTS`, give it a `CONTRIBUTION` row (one entry per stat), and add a `DEPARTMENT_INFO` entry (the label and description shown on the team screen). `MODIFIER_KEYS` picks up `output.<dept>` automatically. A department nobody starts in goes in `SETUP.optionalDepartments`.
2. `data/events.schema.json`: add
   - `personnel.<dept>` under `definitions.conditions.properties`
   - `personnel.<dept>` under `definitions.effects.properties`
   - `personnel.<dept>` in the `per` enum in `definitions.numberChange`
   - `output.<dept>` under `definitions.ongoing.properties.modifiers.properties`
3. Make sure `SETUP.minPerDepartment × number of departments` ≤ `SETUP.headcount.min`.
4. Run `npm run events:check`. It warns about anything still missing from step 2, **except** the `per` enum.
5. Update [GAME_RULES.md](GAME_RULES.md) (departments, contribution table) and [EVENTS.md](EVENTS.md) (paths).

### Adding a stat

1. `rules.js`: add it to `STATS`, `STAT_LIMITS` and `SETUP.stats`, and add the stat to every `CONTRIBUTION` row. Update `computeScore` if it should count towards the score.
2. **Focus:** `setFocus` and the focus model assume exactly two stats, `performance` and `reliability`, so `team.focus[newStat]` would be undefined and break production. Decide how focus applies to the new stat (e.g. a fixed 1.0×) and update `produce()` in `match.js` to match.
3. `server/src/events/conditions.js`: add it to `RANK_VALUES` if `rank.<stat>` should work.
4. `events.schema.json`: add `stats.<stat>` to conditions, effects and the `per` enum; `rank.<stat>` to conditions; `gain.<stat>` to modifiers.
5. `model.js` typedef, then the docs.
6. If it should matter at the competition, add it to the `capability` weights of the relevant disciplines in `RACE.disciplines`.

### Adding a readable or writable path

- **Readable** (conditions, `per`): add a `case` to `readPath()` in `conditions.js`, add the key to `definitions.conditions.properties` in the schema (or a `patternProperties` entry for a family like `flags.*`), and optionally a friendlier label in `pathLabel()`.
- **Writable** (effects): also handle it in `write()` and `normalize()` in `effects.js`, and add it to `definitions.effects.properties`.
- Document it in the path tables in [EVENTS.md](EVENTS.md#conditions).

### Adding a production modifier

1. Use `teamModifier(team, '<key>')` in `produce()` in `match.js`.
2. Add the key to `MODIFIER_KEYS` (if it isn't derived automatically) and to `definitions.ongoing.properties.modifiers.properties`.
3. Document it in [EVENTS.md → Modifiers](EVENTS.md#modifiers) and [GAME_RULES.md](GAME_RULES.md#round-production).

### Adding an effect operator

1. `effects.js`: `nextValue()` (apply), `previewChange()` (preview), `isRemoval()` (if it can remove people via `@` selectors).
2. Schema: add a branch to `definitions.numberChange.anyOf`.
3. `validate.js`: update the `numberChange` hint in `UNION_HINTS`, and `amountsIn()` if it accepts ranges.
4. Add a test, and document it in [EVENTS.md → Effects](EVENTS.md#effects).

### Adding a socket request

1. `server/src/net/sockets.js`: `on(socket, 'area:action', '<role>', async (payload, socket) => { ...; return { ...ackData }; })`. The wrapper handles the role check, the ack format, `GameError` codes and the broadcast.
2. Put the actual state change in `match.js` or the engine (a pure function that throws `GameError`), not in the handler.
3. If clients need new data, add it in `net/views.js` for the right roles only.
4. Add a case to `server/test/sockets.test.js`, including a `forbidden` check for the other roles.
5. Document it in [PROTOCOL.md](PROTOCOL.md#requests-client--server).

### Adding an event field

1. Schema: add it to `definitions.event.properties` (or `option` / `decision`). `additionalProperties: false` rejects unknown fields until you do.
2. Engine: read it in `engine.js`, and add a default in `load()` if it needs one.
3. Cross-reference checks, if any, go in `checkCrossReferences()` in `validate.js`.
4. Add a test, then document it in [EVENTS.md](EVENTS.md#event-fields).

---

## Documentation

Docs are updated **in the same change** as the code they describe:

- Every change adds an entry to [CHANGELOG.md](CHANGELOG.md).
- Step status and open questions go in [ROADMAP.md](ROADMAP.md).
- Behavior, rules, commands and schema changes go in the relevant doc page.
- Commands shown in the docs should actually be run to check them.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Server exits with `Invalid event definitions:` | Fix the listed errors (or run `npm run events:check`) and start again. |
| `[events] reload failed, keeping previous definitions` | The file you just saved is invalid. The game keeps running on the old events until you fix it. |
| Phones can't reach the server | Same WiFi network? Use the LAN URL printed at startup, not `localhost`. On macOS, allow incoming connections for `node` in the firewall prompt. Some venue WiFi networks block devices from reaching each other; a phone hotspot or travel router avoids that. |
| `Startup failed: Missing GM_PASSWORD and SPECTATOR_PASSWORD` | Create `.env` in the repo root (`cp .env.example .env`) and set both. |
| `EADDRINUSE: :3000` | Another server is already running: stop it, or set `SERVER_PORT=3001` in `.env` (the Vite proxy follows it). |
| `npm warn Unknown cli config "--seed"` | You left out `--` before the script's flags. |
| Vite page loads but shows offline (red dot) or stays on "Connecting…" | The game server isn't running or crashed; check the `[server]` lines in the `npm run dev` output. |
| Server restarts whenever any file changes (match lost) | Something added `--env-file` to the server's node command; remove it (see [ARCHITECTURE.md](ARCHITECTURE.md#configjs-and-indexjs)). |
| GM screen shows `Phase loop error (match was paused)` | Something threw while resolving a round (the server log has the stack trace). The match is paused on the results screen; press Resume to continue. Report the error: it's a bug. |
| Countdown looks wrong on one phone | Countdowns use the server's clock (`serverTime`), so the phone's clock doesn't matter; make sure the page is connected (green dot) and reload it. |
| `Too many wrong passwords. Try again in …s.` | 5 wrong GM or spectator passwords from this device; wait a minute. Restarting the server also clears the lockout. |
| A phone shows the join screen again after a server restart | Expected: sessions live in memory until step 9. Rejoin in the lobby. |
| Every tab shows the same team | One session per browser is intended. For local testing, add `?slot=1`, `?slot=2`… to the URL (see [Playing several teams on one computer](#playing-several-teams-on-one-computer)). |
| The GM or spectator screen asks for the password again | The token was cleared (server restart, sign-out, or browser storage wiped). Sign in again. |
