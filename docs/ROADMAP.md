# Roadmap

The build order agreed at kickoff. There's a check-in with the project owner between major steps.

**Legend:** ✅ done · 🔜 next · ⬜ not started

| # | Step | Status |
|---|---|---|
| 1 | Repo scaffold: Express + Socket.IO server, React + Vite client (team + GM views) | ✅ |
| 2 | Data model + in-memory match state | ✅ |
| 3 | Event schema + event engine + CLI | ✅ |
| 4 | Socket.IO wiring: join team, GM auth/role, state broadcast | ✅ |
| 5 | Phase loop: decision timer → resolution → broadcast → next round; GM manual advance | ✅ |
| 6 | Team client UI: staff allocation, focus slider, decision prompts, mobile-first | ✅ |
| 7 | GM client UI: start/pause/reset, live team overview, manual event trigger, direct state edit | ✅ |
| 7½ | The competition: Formula Student event at the end of the season, plus the driverless programme | ✅ |
| 8 | Headless load test: ~10 fake socket clients making random decisions | 🔜 |
| 9 | Reconnection handling, JSON snapshots to disk, resilience | ⬜ |
| 10 | Polish: QR join flow, scoring/end screen, spectator view | ⬜ |

---

## Done

### 1 · Scaffold
- npm workspaces (`server`, `client`), with a root `dev` script that runs both.
- A single Vite app with path-based views: `/` team, `/gm` GM.
- Express serves the built client and `/api/health`.
- The Vite dev server is reachable on the LAN and forwards socket and API requests to the server.

### 2 · Data model
- Plain-JSON `Match` and `Team`, documented in `model.js`.
- Seeded RNG whose state is stored in the match.
- Tuning and scoring in `rules.js`.
- Random team setup, validated allocation and focus changes, match lifecycle, round production.
- `sim:state` checks that matches are reproducible and that snapshots can be restored.

### 3 · Event engine
- `data/events.json` with a JSON Schema: conditions, effects, ongoing effects, decisions with `hideEffects`, guaranteed `followUp`, global scope, limits.
- Engine: weighted rolls, eligibility, generic effect application, the decision lifecycle, follow-ups, GM trigger, `explain`/`eligibleFor`, team decision view.
- Validator with readable errors, typo suggestions and cross-reference warnings.
- Live reload that keeps the previous definitions if the new file is invalid.
- `sim:events` CLI (feed / try / stats).

### 4 · Socket wiring
- **Roles:** `guest`, `team`, `gm`, `spectator`, each with its own view. The server checks the role on every request.
- **Joining:** participants enter a unique team name; lobby only, no late joins. Teams can leave, or the GM can remove them, while still in the lobby.
- **Auth:** GM and spectator passwords come from `.env`, compared in constant time, with a 5-attempt / 60 s lockout. Session tokens are sent in the handshake, so refreshes and reconnects re-attach.
- **Privacy:** events are private. Teams see their own full state, only the name/color/location of other teams, and the public feed. The spectator sees the public parts. Final standings become public at the end.
- **Paddock feed:** a new `post` field on event outcomes publishes social-media-style snippets with placeholders (`{team}`, `{change.budget}` …).
- **Protocol:** every request gets an ack (`{ ok }` / `{ error: { code, message } }`), and the server pushes full per-role snapshots after changes. GM requests: start/pause/resume/end/reset, remove team, trigger event, reload events.
- **Client:** `useGame(view)` hook, join screen, basic team summary with feed, GM login + lifecycle buttons, `/screen` spectator login + feed.
- **Tests:** 8 socket integration tests (27 in total), checked by deliberately breaking the privacy filters.
- Economy wording: "salary" renamed to per-member running costs (`costPerMember`), because students aren't paid.

### 5 · Phase loop
- `server/src/phases.js`: a single timer driven by `match.phaseEndsAt`. It runs decision (`decisionSeconds`) → resolve round → results (`resolutionSeconds`) → next round → … → end, broadcasting every change.
- GM: `gm:advance` (skip the phase, also resumes when paused), `gm:addTime` (±seconds, also while paused), `gm:configure` (rounds and phase lengths, lobby only), plus start/pause/resume/end/reset now go through the loop.
- Robustness: cancelled timers can't fire late (generation counter), early timers re-arm, and an exception during a timed transition pauses the match with an error shown to the GM instead of crashing the server. `sync()` re-arms a restored match, ready for step 9.
- Clients: a live countdown based on the server clock (red in the last 10 s of a decision phase); "until next round" / "until final standings" during results. The GM screen got Next phase, ±time and a settings form.
- Tests: 11 new (fake-clock unit tests + a real-timer socket run), 38 in total. The stale-timer and crash-safety tests were checked by removing those safeguards and seeing the tests fail.

### 6 · Team screen
- Two columns on tablets and laptops (the main devices), one column on phones. Header with team identity, phase and countdown.
- Stat tiles for budget, performance, reliability and score, with 0–100 meters and the change during the last round (arrow + sign, never color alone).
- Staff steppers with a "bench": taking someone out of a department and putting them elsewhere saves automatically; the status line always says whether it's saved. Department labels, per-person contributions and running costs come from the server.
- Focus slider with live multipliers, saved shortly after the last movement.
- Decision cards with effect previews (or "Effects unknown" when hidden), locked options with the reason, the choice highlighted, and what happens if they don't answer.
- Round panel: a forecast of this round's production during decisions, and the results plus what happened during the results phase (it moves to the top then).
- Active effects with rounds left, a private team inbox grouped by round, the public feed, and the final standings table with the team highlighted.
- Server: `projectProduction()` (the forecast, also used by the real resolution), team `start` values, department labels, `VISIBILITY.ownScoreDuringMatch`, and per-round effects in option previews.
- Tests: `views.test.js` (forecast matches the resolution, rules payload, score hiding) and client `format.test.js` (wording). 44 in total.

### 7 · GM dashboard
- Control bar: phase, countdown, start / next phase / pause / resume / ±time / end / reset, lobby settings, online counts, and any phase-loop error.
- Live team table: budget, stats, score, staff split, focus, connection, pending decisions, active effects and (GM-only) scheduled follow-ups. Sortable by score, budget, stats or name.
- Trigger an event: search by name/id/tag, pick teams, optionally respect conditions, fire it — plus "Why wouldn't it fire?" (`gm:explain`), which lists per team what's blocking it.
- Edit a budget in place (`gm:patchTeam`), the one live fix; the team sees it in its inbox as a Game Master adjustment.
- Race Control posts (`gm:post`): the GM's own announcements in the public paddock feed, shown to teams and the projector.
- Event file panel: how many events are loaded, the last reload's warnings/errors, and a Reload button.

### 7½ · The competition (added at the owner's request)
- **Driverless programme**: opt-in during the season for a setup fee and a running cost. It unlocks the Driverless & Software department and the autonomy stat, raises sponsorship income, and is the only way to score in the two DV disciplines.
- **The event**: ten disciplines worth 1000 points, computed in one seeded pass from each team's final state — three statics (with a finals round for the top four), five timed disciplines, 18-lap endurance with retirements and reasons, and efficiency for finishers.
- **The reveal**: the GM announces it step by step (34 steps for a normal field); teams and the projector only ever receive what has been announced. The podium closes it, and only then do teams and the projector get the final standings (competition points).
- **Tuning**: every discipline's weights, typical winning times and their variation, point values and the DNF curve live in `RACE` in `rules.js`; `npm run sim:race` reports the balance across many seasons.

---

## Next: step 8 plan (draft)

A headless load test so the whole thing can be exercised without 10 devices:

- A script (`server/scripts/load-test.js`) that connects N fake team clients over real sockets, joins, and each round: reallocates staff, moves focus, answers decisions (sometimes not at all).
- Runs against a server started by the script itself (short phases) or against a running one (`--url`), with `--teams`, `--rounds` and a seed.
- Reports: requests sent, errors by code, broadcast counts, slowest ack, and the final standings — so the workshop setup can be sanity-checked on the venue laptop.
- Also a good stress test for the phase loop: everything happening at the moment a phase flips.

---

## Decisions

| Question | Decision | Date |
|---|---|---|
| Event schema format | JSON + JSON Schema, declarative conditions/effects | 2026-09-15 |
| Show option consequences? | Yes by default; `hideEffects` true/false per decision, overridable per option | 2026-09-15 |
| Guaranteed follow-ups | Yes: `followUp: { event, inRounds }` | 2026-09-15 |
| Max pending decisions per team | 1 | 2026-09-15 |
| What can a team see about other teams? | Only public snippets (sponsorships, promos, social media) via the paddock feed, plus name/color/location | 2026-09-16 |
| How do participants get a team? | Enter a name and join | 2026-09-16 |
| GM authentication | Password (`GM_PASSWORD` in `.env`) | 2026-09-16 |
| Late joins after start | Not allowed | 2026-09-16 |
| Event visibility for other teams / spectator | Private; the spectator screen is password-protected (`SPECTATOR_PASSWORD`) | 2026-09-16 |
| Per-member costs | Students aren't paid: reframed as running costs per member (travel, safety gear, tools), same mechanic | 2026-09-16 |
| State sync | Full per-role snapshots after every change, no diffs | 2026-09-16 |
| Pause during the results phase | Allowed (e.g. to discuss results with the room); the countdown freezes in both phases | 2026-09-16 |
| GM "next phase" while paused | Resumes and advances in one click | 2026-09-16 |
| Match settings | Rounds, decision and results length set by the GM in the lobby (1–30 rounds, 10–600 s, 3–120 s); timer ±time during the match | 2026-09-16 |
| Failure during round resolution | Pause on the results screen and show the error to the GM, never crash the server | 2026-09-16 |
| Main devices | Tablets and laptops; phones still supported (single column) | 2026-09-16 |
| GM feed posts | Yes: "Race Control" announcements in the paddock feed | 2026-09-16 |
| Driverless | An opt-in programme with a setup fee, a running cost, its own department and the autonomy stat; no programme means 0 points in both DV disciplines | 2026-09-16 |
| Competition scoring | Judged disciplines scale to the best score; timed ones use the FS curve with a 1.5× cutoff | 2026-09-16 |
| Winning times | ~~Always exactly the given time~~ → the given times are typical: each discipline's pace varies ±4% per competition and every run loses up to 3%, so winning times differ every time | 2026-09-16 |
| Endurance screen | Timing board with total time, gap, last lap and best lap per car, plus the race's fastest lap | 2026-09-16 |
| Race pacing | The GM reveals it step by step rather than an automatic playback, so they can narrate | 2026-09-16 |
| Live GM editing | Budget only; everything else should come from the game itself | 2026-09-16 |
| Own score during the match | ~~Visible to the team~~ → **hidden from players**; only the GM sees the season score, and the competition decides the winner (`VISIBILITY.ownScoreDuringMatch: false`) | 2026-09-16 |
| Staff changes | Saved automatically once nobody is on the bench, instead of an explicit Apply button | 2026-09-16 |
| Round forecast | Computed on the server (`projectProduction`) and sent to the team, so the client never duplicates the rules | 2026-09-16 |
| Team scale | 30–140 members and €80,000–€400,000 budgets (roughly correlated with size), realistic for FS teams | 2026-09-16 |
| Locations | Each city has a cost level and a sponsor level; expensive places have richer sponsors, but not enough to make up for it | 2026-09-16 |
| Big teams | Diminishing returns on staff (`members ^ 0.65`) and headroom near 100, so size helps without deciding the season | 2026-09-16 |
| Number of rounds | 14 by default; the economy is scaled to the round count, so any length is balanced and the GM picks it by available time | 2026-09-16 |
| Several teams on one computer | `?slot=<n>` in the URL gives a tab its own team session, for local testing | 2026-09-16 |

---

## Open decisions

| Question | Options | Needed for |
|---|---|---|
| Should the projector show a live leaderboard during the match? | no, standings only at the end (current) · live scores · live ranks without numbers | step 10 |
| Should the running cost per member stay a flat €300 (× location)? | keep · per-department costs · replace with material/competition costs | balance pass |
| Is the driverless programme too strong? | keep (winners run it 72% of the time in simulations) · raise its costs · move points away from the DV disciplines | playtest |

---

## Known issues and tech debt

| Issue | Notes |
|---|---|
| Event balance is untested | In a 14-round season `local_sponsor` hits a team ~1.7 times and `aero_lead_sick` ~1.3 times, probably too often; `recruitment_slump` fires in only 18% of matches. See [GAME_RULES.md → Balance notes](GAME_RULES.md#balance-notes). |
| Decisions created in the final round never get applied | Random rolls avoid this, but a GM trigger or follow-up with a decision in the last round is left pending. Option: apply timeouts in `endMatch`. |
| A crash during resolution can leave a half-resolved round | The loop pauses and reports it, but the partly applied round isn't rolled back. Step 9 snapshots (taken before each resolution) would allow a clean retry. |
| Match settings can't change mid-match | Only ±time during the match; changing round count or phase length needs a reset. |
| Sessions and the match live only in memory | A server restart logs everyone out and loses the match (step 9: snapshots incl. sessions). |
| Lockout is per client address | Everyone behind one NAT address shares the lockout counter; fine on workshop WiFi, where each phone has its own address. |
| About one in five randomly played teams ends the season in debt | Intended pressure, but check in playtesting that it doesn't feel hopeless for small teams in expensive cities. |
| Adding a stat needs a focus-model decision | The focus slider assumes exactly `performance` + `reliability`. See [DEVELOPMENT.md](DEVELOPMENT.md#adding-a-stat). |
| The spectator screen is still basic | Step 10 (projector polish, QR join, end screen). |
| GM actions have no undo | A budget edit or a triggered event can't be taken back; the team's log keeps the record. |
| Driverless teams win ~72% of simulated seasons | About 4 of 10 teams run one, so the programme may be too strong. Levers: `AUTONOMOUS` costs, `incomeMultiplier`, or the DV disciplines' share of the 1000 points. |
| The endurance reveal is 18 clicks | Fine for a show, tedious if the GM wants to rush. An auto-play or "skip to result" button would help. |
| No progress charts | The team screen shows the last round's change and the private inbox, but not a trend over rounds. Candidate for the step 10 end screen. |
| The team screen has no tab navigation on phones | Everything is one long column; fine for tablets, a bit long on a phone. |
