# Changelog

Every change is recorded here, newest first. Entries are grouped by working session and step.

---

## 2026-09-16 · Varying race times and endurance timing

### Changed
- **Winning times are no longer fixed.** The times in the rules are now *typical* winning times. Every discipline draws its own pace for the competition day (`RACE.dayVariation`, ±4%: track, weather, wind), and every run loses a random 0–3% against the car's potential (`RACE.runVariation`: a missed shift, a wide line). The best car no longer always lands on exactly 3.2 s / 4.6 s / 72 s, and close cars can swap places. The same applies to the endurance lap pace and the efficiency figure.
- Race times are shown with two decimals everywhere (3.27 s instead of 3.3 s), so close results don't look tied. The efficiency column is headed "Energy used".
- `sim:race` reports the winning time's average and range next to the typical time.

### Added
- **Endurance timing board:** after every lap, each car's **total time** (m:ss.ss), **gap** to the leader, **last lap** and **best lap**, plus a "⏱ Fastest lap: team, time, lap" line and a ⏱ marker on that car's best lap. Retired cars show how many laps they completed. The endurance result shows total time and best lap as separate columns.
- Payload: `endurance-lap` steps carry `fastestLap`, and their `order` entries now have `gap` (seconds, `null` once retired), `lastLap` and `bestLap`; `endurance-result` carries `fastestLap`.
- `formatRaceTime()` and `formatDuration()` in `client/src/lib/format.js`.
- Tests: winning times vary between competitions (sometimes faster, sometimes slower than typical), the timing board's order, gaps and lap times, and the time formatting — 59 tests in total.

### Verified
- `npm test` (59 passing), `npm run build`.
- `sim:race` (50 seasons): winning acceleration 3.12–3.42 s (typical 3.2), skidpad 4.46–4.86 s (4.6), autocross 69.4–76 s (72), fastest endurance lap 70.4–76.3 s (74), efficiency 18.0–19.5 kWh (18.5). Endurance retirements 14%, winners average 863/1000.
- In the browser with a 7-team test competition: acceleration was won in 3.14 s; the lap 12 board showed total time, gaps (over a minute as +2:01.92), last and best laps and the fastest lap; the endurance result showed two cars 0.01 s apart. Checked at tablet (768 px) and phone (375 px) widths with no page overflow. The test teams were removed afterwards.

---

## 2026-09-16 · Realistic team scale, hidden scores, locations with costs

### Changed
- **Scores are hidden from players.** Teams never receive a season score (`me.score`, `start.score` and `history[].score` are always `null`), and teams and the projector get no `standings` until the competition's podium has been shown; the final table then shows competition points. The GM still sees season scores and, once the season ends, season standings.
- **Team scale:** 30–140 members (3 per regular department to start) and budgets of €80,000–€400,000 = team size × a random €1,800–€3,800 per member, rounded to €5,000. Bigger teams tend to have more money, but not always.
- **Locations have a cost level and a sponsor level** (Zurich ×1.45 costs / ×1.25 sponsors … Warsaw and Budapest ×0.75 / ×0.8). Costs multiply per-member and driverless running costs; sponsor level multiplies sponsorship. Shown in the team header.
- **Diminishing returns on staff:** department output is `members ^ 0.65` (`SEASON.staffExponent`), for production and for the competition's capability, so a big team is stronger but not proportionally. Stat gains also shrink as a stat nears 100 (headroom `1 − stat/100`).
- **Season length is balanced:** every per-round number is tuned for `SEASON.referenceRounds` = 14 and scaled by `14 / totalRounds`, so 8-, 14- and 16-round seasons end in nearly the same place. `MATCH_DEFAULTS.totalRounds` is now 14.
- Economy retuned for the new scale: `baseIncome` €3,000, `sponsorshipPerOutput` €2,300 (replaces `sponsorshipPerBusiness`), `costPerMember` €300, new `CONTRIBUTION` values, score weights per €10,000. Driverless programme: €35,000 setup, €4,000 per round (× cost level), sponsors ×1.2, autonomy 1.1 per driverless output and 0.15 per electronics output.
- Random events a little rarer per round for the longer season (`teamEventChance` 0.45, `globalEventChance` 0.15). `events.json` money and staff effects rescaled (e.g. sponsor deal €15,000–€35,000, investor €50,000, scandal −€75,000, burnout −2 to −4 people, HV audit €400 per member).
- The competition's Cost & Manufacturing now weighs `budgetKept` (budget now ÷ starting budget, 0–1.5), so a small team that handled money well can beat a rich one; Business Plan uses `incomePer10k`.
- `rules.departments` in the team payload is now just `{ id, label, description }`; what departments produce is in the new `me.projection.departments` (per department: output per round and `nextPerson` = what one more person adds, and costs). `me.projection.programmeCost` gives the programme's actual per-round cost for the team. `PublicTeam.location` includes `costLevel` and `sponsorLevel`.
- **Staff panel:** −5 / −1 / +1 / +5 steppers; each department shows what it produces per round and what the next person would add; the header shows what one member costs per round at this location. On phones the steppers go under the text.
- The driverless programme card shows the team's real running cost (location and season length included).
- `sim:events`, `sim:state` and `sim:race` default to 14 rounds; simulated teams only start a programme when they can afford twice the setup fee.

### Added
- **`?slot=<n>`** in the URL keeps a separate team session per tab (`eforce.token.team.<n>`), so several teams can be played from one browser for testing. The slot is shown in the team header.

### Verified
- `npm test`: 56 passing. `npm run build`, `events:check` (11 valid), `sim:state` (deterministic, snapshot/restore identical).
- `sim:race` (50 seasons, 14 rounds): every discipline's leader on its target time, endurance retirements 14%, winners average 861/1000, driverless teams win 72% of seasons.
- In the browser: two teams joined from `?slot=1` and `?slot=2` in one browser and stayed separate; −5 put five people on the bench and +5 elsewhere auto-saved, with the department numbers updating from the server; checked tablet (768 px) and phone (375 px) layouts with no horizontal scroll. The test teams were removed afterwards.

---

## 2026-09-16 · The competition and the driverless programme

### Added
- **The driverless programme** (`team:setAutonomous`): opt-in during the season for a €4,000 setup fee and €700 per round. It unlocks the new **Driverless & Software** department and the **autonomy** stat (0–100, unaffected by the focus slider), and multiplies sponsorship income by 1.25. Stopping it requires an empty department; the fee isn't refunded.
- **`server/src/game/race.js`**: the end-of-season competition — ten disciplines worth 1000 points, computed in one seeded pass from each team's final state:
  - statics (Design 150, Cost 100, Business 75) judged on capability, with a finals round for the top four and a ±8% presentation swing
  - timed disciplines (Acceleration 50, Acceleration DV 75, Skidpad 50, Skidpad DV 75, Autocross 100) where the field leader sets the advertised target time and points follow the FS curve with a 1.5× cutoff
  - Endurance 250 over 18 simulated laps, with per-lap failures driven by reliability and a retirement reason weighted towards the team's thinnest department
  - Efficiency 75 for endurance finishers
  - a 34-step reveal timeline ending on the podium
- **GM controls**: `gm:startRace`, `gm:raceAdvance`, `gm:raceBack`, and a race panel on the dashboard.
- **Race screen** shared by the team view, the projector and the GM: discipline tables, a live endurance lap board with gaps and retirements, the overall standings and the podium.
- Team screen: a driverless programme card (costs, benefits, start/stop), an autonomy stat tile, and the locked driverless department until the programme starts.
- `npm run sim:race`: plays seasons and runs the competition, reporting points per discipline, leader times vs targets, retirement rate and how often driverless teams win.
- Event vocabulary: `stats.autonomy`, `personnel.driverless`, `autonomous`, `rank.autonomy`, `output.driverless`, `gain.autonomy`.
- `race.test.js` (9 tests) and socket tests for the reveal and the programme — 56 tests in total.

### Changed
- Final standings come from the competition once the podium has been shown (`standings[].source` is `season` before that, `race` after).
- Teams and the spectator screen receive only the announced race steps and no totals until the end, so nothing can be read ahead in the browser.
- Endurance failure odds were retuned after simulating: roughly 85% of cars retire at reliability 0, 20% at 40, 8% at 60, 1% at 100.

### Verified in the browser
- Started the programme from the team screen: budget dropped by exactly the fee, the autonomy tile appeared, staffing the department became possible, and the forecast showed the €700 running cost and the higher sponsorship income.
- Played a six-round season with four teams (two driverless), then ran the competition: Engineering Design with its finals, driverless acceleration showing "no driverless car" and 0 points for the two teams without a programme, a lap-13 retirement announced with its reason on the live lap board, the overall standings and the podium — after which the final standings switched to competition points.

---

## 2026-09-16 · Step 7: GM dashboard

### Added
- **GM dashboard** (`client/src/gm/`): control bar (phase, countdown, start / next phase / pause / resume / +30s / −15s / end / reset, lobby settings, phase-loop error), live team table, event trigger, Race Control posts and event-file status.
- **Team table:** budget, performance, reliability, score, staff split, focus, connection dot, pending decisions ("to answer" / "answered"), active effects and GM-only scheduled follow-ups. Sortable by score, budget, stats or name.
- **`gm:patchTeam { teamId, budget }`**: the GM's one live fix. Validated (whole number, budget only, |budget| ≤ 10,000,000) and written to the team's own log as a "Game Master adjustment", so the team sees the correction.
- **`gm:post { text }`**: announcements in the public paddock feed as **Race Control** (`teamId: null`, `source: 'gm'`, ≤ 280 chars), shown to teams and the spectator screen.
- **`gm:explain { eventId }`**: read-only per-team answer to "why wouldn't this event fire by itself?", used by the trigger panel.
- GM payload now includes `rules` and `scores`, so the GM screen never reimplements the scoring formula.
- Feed posts carry `source` (`'event'` or `'gm'`); the feed shows GM posts as Race Control in the accent color.
- Socket tests for the three new requests (45 tests in total).

### Fixed
- The GM control bar showed "round 1/" because the GM gets the raw match object, where the round count lives in `config`.

### Verified in the browser
- Rendered the dashboard from a captured GM payload (4 teams, events fired, a decision answered, a Race Control post) to check the layout without signing in: control bar, team table with badges, trigger panel and feed.
- Event search filtered to matching events, selecting one showed the team pickers, "Why wouldn't it fire?" rendered per-team answers, and the inline budget editor opened, saved and closed.

---

## 2026-09-16 · Step 6: Team screen

### Added
- **Team dashboard** (`client/src/team/`), two columns on tablets/laptops and one on phones:
  - header with team identity, phase and countdown
  - stat tiles for budget, performance, reliability and score, with 0–100 meters and the change during the last round (▲/▼ + sign, so direction never depends on color)
  - `StaffPanel`: a +/− stepper per department with a "bench", automatic save once the bench is empty, per-person contributions, running costs, and a badge when an active effect changes a department's output
  - `FocusPanel`: reliability ↔ performance slider with live multipliers, saved ~300 ms after the last movement
  - `DecisionsPanel`: option cards with effect previews (or "Effects unknown"), locked options with their reason, the current choice marked, and the no-answer outcome
  - `RoundPanel`: this round's forecast during decisions; the round's results and everything that happened during the results phase (where it moves to the top)
  - `EffectsPanel`, `InboxPanel` (private log grouped by round), the public feed and a final standings table with the team highlighted
  - a banner explaining whenever inputs are locked (paused, results phase, ended, disconnected)
- **Server:**
  - `projectProduction(team)`: the forecast used both by the team screen and by the real resolution (`produce` now calls it)
  - `team.start` (budget/stats at join) so clients can show change-since values
  - `DEPARTMENT_INFO` labels/descriptions and a `rules` block in the team payload (departments, economy, focus multipliers, stat limits)
  - `VISIBILITY.ownScoreDuringMatch` (default `true`); when off, scores are stripped from `me`, `start` and `history` until the match ends
  - option previews now include an ongoing effect's per-round effects
- **`client/src/lib/format.js`** with tests: wording for effects, changes and modifiers, shared by every panel.
- `npm test` now also runs the client tests (44 in total).

### Verified in the browser
- Tablet (1024×768), laptop and phone (375) layouts; no horizontal overflow on the phone.
- Took a person out of Aerodynamics (bench warning appeared), added them to Electronics: saved automatically and the server's forecast changed (+3.5 → +4.4 reliability).
- Moved the focus slider to 75% performance: "Saving…" → "Saved", forecast updated.
- Answered a decision: the option is marked as the choice; after the round it appeared in the results with its changes.
- Results phase: lock banner, results panel first, disabled steppers; end of match: standings with "(you)".

---

## 2026-09-16 · Step 5: Phase loop

### Added
- **`server/src/phases.js`**, `createPhaseLoop()`: runs matches on a timer (decision → resolve → results → next round → … → end) with one timer derived from `match.phaseEndsAt`. It broadcasts on every change, invalidates stale timers with a generation counter, re-arms timers that fire early, has an injectable clock, and provides `sync()` for restored snapshots.
- **Crash safety:** an exception during a timed transition is logged, the match is paused on the results screen, and the GM view shows `loop.lastError` until reset, instead of the error crashing the server.
- **GM requests:**
  - `gm:advance`: end the current phase now; resumes a paused match
  - `gm:addTime { seconds }`: ±600 s, minimum 1 s left, also while paused
  - `gm:configure { totalRounds, decisionSeconds, resolutionSeconds }`: lobby only
- `match.js`: `configureMatch`, `startPhaseTimer`, `adjustPhaseTime`; `rules.js`: `MATCH_LIMITS`, `MAX_TIME_ADJUST_SECONDS`.
- GM payload: `loop: { timerArmed, lastError }`.
- `createGameServer()` options `matchConfig` and `clock`; returns `loop`.
- **Client:** `useCountdown(match, serverTime)` with the server-clock offset; the phase line shows "Decision phase · round 2/8 · 0:42 left", "Round results · 0:08 until next round" / "until final standings", and "Paused". The timer turns red in the last 10 s of a decision phase and is bigger on the projector. The GM screen got Next phase / Finish match, Pause⇄Resume, +30s, −15s, End, and a lobby settings form.
- `server/test/phases.test.js`: 10 fake-clock tests + 1 real-timer socket test. There are now 38 tests.

### Changed
- `gm:start`, `gm:pause`, `gm:resume`, `gm:end` and `gm:reset` go through the phase loop instead of calling `match.js` directly.
- Pausing is allowed in both phases (decided).
- `sockets.test.js` resolves rounds with `gm:advance` instead of calling `resolveRound` directly.

### Verified in the browser
- Phone view: countdown ticks, turns red under 10 s; the timer alone resolved round 1 (stats, budget and a feed post updated) and started round 2; pause froze the timer, and +30 s showed 0:41; next phase while paused jumped to results; the final results showed "until final standings"; the timer ended the match and showed standings.

---

## 2026-09-16 · Step 4: Socket wiring, auth, privacy, paddock feed

### Added
- **Roles and auth** (`server/src/net/auth.js`, `sockets.js`):
  - roles `guest`, `team`, `gm`, `spectator`, checked on the server for every request (`forbidden`)
  - GM and spectator passwords from `.env` (`GM_PASSWORD`, `SPECTATOR_PASSWORD`, both required), compared in constant time, 5-attempt / 60 s lockout per client and role
  - random session tokens sent in the Socket.IO handshake, so refreshes and reconnects re-attach; `session:invalid` / `session:ended` tell clients to clear stale tokens
- **Joining:** `team:join { name }` with unique, case-insensitive, trimmed names; lobby only (no late joins); `team:leave` and `gm:removeTeam` in the lobby.
- **Requests:** `team:allocate`, `team:focus`, `team:answer`, `gm:start|pause|resume|end|reset|removeTeam|trigger|reloadEvents`, `session:logout`, `state:request`. Every request gets an ack with `{ ok }` or `{ error: { code, message } }`.
- **Per-role state** (`server/src/net/views.js`): full snapshots after every change, coalesced per tick.
  - Teams: own full state, other teams as name/color/location only, public feed.
  - Spectator: public parts. GM: everything, plus online counts and event definitions.
  - Final standings are public after the match ends.
  - Team payloads strip flags, follow-up scheduling and the event `source`.
- **Paddock feed:** new optional `post` on events, decision options and custom `onTimeout` outcomes. It publishes a public social-media snippet with placeholders `{team}`, `{location}`, `{country}`, `{change.<path>}` (`server/src/events/posts.js`, `match.feed`). The validator rejects unknown placeholders and warns when `{change.x}` would read 0. Starter events got posts.
- `server/src/app.js`: `createGameServer()` builds the server without listening, shared by `index.js` and the tests.
- `server/src/config.js`: environment + repo-root `.env`, `SERVER_PORT`, `SEED`.
- **Client:** `useGame(view)` hook (`client/src/net/game.js`), shared components, team join screen with a basic team summary and feed, GM login with lifecycle buttons and team list, new `/screen` spectator view with login, teams, feed and standings.
- `server/test/sockets.test.js`: 8 integration tests (joining, sessions, auth, lockout, late joins, privacy, feed, decisions, end/reset). The privacy checks were confirmed by deliberately breaking `views.js` and seeing the tests fail. There are now 27 tests.
- `sim:events` prints public posts (📣).
- `docs/PROTOCOL.md`: full socket protocol reference.
- `.env.example`; `.env` is git-ignored.

### Changed
- `ECONOMY.salaryPerPerson` → `costPerMember`, described as running costs per member (travel, safety gear, tools), because students aren't paid. The value (€400) and the mechanic are unchanged.
- `addTeam` no longer has `allowMidMatch`, rejects duplicate names (`name_taken`) and dedupes default names. `removeTeam` added.
- `resetMatch` keeps team ids and colors stable, so connected clients stay attached.
- Match state gained `feed` and `nextPostNumber`.
- Socket.IO no longer enables CORS (same-origin in dev via the Vite proxy and in production).
- The Vite dev proxy reads `SERVER_PORT` from the repo-root `.env`; `strictPort` is on.
- The server prints one LAN URL per interface, with the team/GM/spectator paths listed once.

### Fixed
- **Dev server restarted on any file change in the repo** (wiping the match) when `.env` was loaded with `node --env-file`: in watch mode, Node watches the env file's whole directory. `.env` is now read by `config.js`.
- **Dev server crashed with `EADDRINUSE :5173`** when a tool set `PORT` for Vite. The server now uses `SERVER_PORT`.

---

## 2026-09-15 · Documentation

### Added
- `docs/` documentation set:
  - [EVENTS.md](EVENTS.md): event authoring guide, full schema reference, timing, recipes, validation messages
  - [GAME_RULES.md](GAME_RULES.md): match structure, starting conditions, production formulas, event frequency, scoring, balance notes
  - [ARCHITECTURE.md](ARCHITECTURE.md): system overview, principles, server/client structure, data model, resolution pipeline, engine API, determinism, error codes
  - [DEVELOPMENT.md](DEVELOPMENT.md): setup, scripts, CLI tools, tests, conventions, extension checklists, troubleshooting
  - [ROADMAP.md](ROADMAP.md): step status, step 4 plan, open decisions, known issues
  - this changelog
- README rewritten as an overview and index for the docs.

### Fixed
- The root scripts `npm run sim:state` and `npm run events:check` were dropping arguments (e.g. `--seed=abc` was ignored, with an `Unknown cli config` warning). They now pass everything after `--` through, like `sim:events`.

---

## 2026-09-15 · Step 3: Event engine

### Added
- **Event engine** (`server/src/events/engine.js`, `conditions.js`, `effects.js`):
  - loads and validates `data/events.json`; definitions are frozen and filled in with defaults
  - weighted random rolls: due follow-ups first, then one global roll, then one roll per team
  - eligibility: `enabled`, `weight`, `conditions`, `maxPerTeam`, `maxPerMatch`, `cooldownRounds`, pending-decision limit, and no decision events in the final round
  - generic effects: add, `[min,max]` ranges, `add`+`per`, `multiply`, `set`; `personnel.@random/@largest/@smallest`; flags as booleans, strings or counters; clamping
  - ongoing effects with `perRound` effects and production `modifiers`; re-applying one restarts it instead of stacking
  - decision lifecycle: pending, answered (can be changed until resolution), applied at resolution, or timed out at the due round
  - GM `trigger`, plus `explain`, `eligibleFor`, `decisionsView`, `reload`, `watch`
- **`hideEffects`** (true/false) on decisions, with a per-option override. Hidden options have no preview in `decisionsView`.
- **`followUp: { event, inRounds }`** on events, options and custom `onTimeout` outcomes: a guaranteed later event that ignores weight, conditions, limits and `enabled`.
- Condition paths `rank.*` (1 = best) and `active.<id>`.
- `EVENT_ROLLS.rollAfterFollowUp` in `rules.js`.
- Validator: `followUp` targets must exist; the weight-0 warning is skipped for follow-up targets.
- `npm run sim:events` CLI: match feed, `--try=<id>`, `--matches=N` stats.
- `npm test`: 17 `node:test` tests covering the engine.
- Server loads the engine at startup (exits on invalid events) and hot-reloads `data/events.json`, keeping the previous definitions if the new file is invalid.
- Starter events: `mystery_investor` (hidden effects + follow-up + custom timeout), `investor_scandal`, `recruitment_slump` (counter-flag chain).

### Changed
- `sensor_batch_failure` → `sensor_dropout` now uses `followUp` instead of a flag.
- `crunch_burnout` increments `flags.burnouts`.
- Match: `globalLog` replaced by `eventHistory`; added `nextDecisionNumber`. Team: added `scheduledEvents`. Log entries now have a `kind`.
- `npm run dev` no longer restarts the server when `data/` changes (a restart would wipe the match); event edits are hot-reloaded instead.

---

## 2026-09-15 · Steps 1–2: Scaffold, data model, event schema proposal

### Added
- npm workspaces: `server` (Express 5, Socket.IO 4, Ajv) and `client` (React 19, Vite 8).
- A single client app with path-based views (`/` team, `/gm` GM), a shared socket hook and a dark CSS theme.
- Server: static client hosting with a fallback to `index.html`, `/api/health`, placeholder `server:hello` handshake, LAN URL printout.
- Seeded, snapshot-safe RNG (`rng.js`).
- `rules.js`: departments, stats, setup ranges, contribution table, focus multiplier, economy, event roll chances, scoring formula.
- `match.js`: match/team creation, random team setup, validated allocation/focus, lifecycle (start/pause/resume/end/reset), round production and history.
- `model.js`: JSDoc data model.
- `npm run sim:state`: 10-team simulation that checks reproducibility and snapshot restore.
- Event schema proposal: `data/events.schema.json` and 8 starter events; `npm run events:check` with readable errors and typo suggestions.
