# eForce Paddock

A live multiplayer team-management game for conference workshops. About 10 participants each run a Formula Student racing team from a tablet, laptop or phone over local WiFi, while a Game Master (GM) runs the match from a separate dashboard and a projector shows the public paddock feed.

Each team starts with a random location (cheap or expensive city), a budget of €80,000–€400,000 and 30–140 members. The season is played in **rounds** (14 by default; any length is balanced):

1. **Decision phase** (60–90 s): teams assign staff to departments, set a reliability-vs-performance focus, and answer pending event decisions.
2. **Resolution phase**: the server applies every decision, runs the team economies, rolls random events, and sends the new state to everyone.

What happens to a team stays private. Other teams only see what gets posted publicly: sponsorship deals, teasers, scandals. Nobody sees a score during the season: the competition decides the winner.

During the season each team also decides whether to build a **driverless car** — expensive, and the only way to score in the two driverless disciplines. After the last round, the Game Master runs the **competition**: a Formula Student event worth 1000 points (design, cost and business judging with finals, acceleration, skidpad, autocross, 18 laps of endurance with retirements, and efficiency), revealed one announcement at a time.

> **Status:** steps 1–7 of 10 are done (scaffold, data model, event engine, networking, timed rounds, team screen, GM dashboard), plus the end-of-season competition. A headless load test is next. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Quick start

Requires Node.js 22+ (developed on 26).

```bash
npm install
```

Create `.env` in the repo root and set `GM_PASSWORD` and `SPECTATOR_PASSWORD`:

```bash
cp .env.example .env
```

```bash
npm run dev
```

| Page | URL (dev) | Who |
|---|---|---|
| Team | `http://localhost:5173/` | participants: enter a team name and join |
| Game Master | `http://localhost:5173/gm` | GM password |
| Spectator screen | `http://localhost:5173/screen` | spectator password, for the projector |

Phones on the same WiFi use the LAN address Vite prints.

To play several teams from one computer while testing, open one tab per team with its own slot: `http://localhost:5173/?slot=1`, `?slot=2`, … (see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#playing-several-teams-on-one-computer)).

Production (everything served from one port, default 3000):

```bash
npm run build && npm start
```

The server prints its LAN URLs on startup, e.g. `http://192.168.0.243:3000`.

## Documentation

| Document | Read it when you want to… |
|---|---|
| [docs/EVENTS.md](docs/EVENTS.md) | **add or change random events** (full reference, public posts, recipes) |
| [docs/GAME_RULES.md](docs/GAME_RULES.md) | understand or tune the economy, visibility rules, event frequency and scoring |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | build a client: socket requests, roles, state payloads, error codes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | understand how server, clients, match state and the event engine fit together |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | set up, run scripts/tests/simulations, or extend the engine |
| [docs/ROADMAP.md](docs/ROADMAP.md) | see build progress, decisions, open questions and known issues |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | see what changed and when |

## Common commands

| Command | What it does |
|---|---|
| `npm run dev` | server + client with auto-reload |
| `npm test` | server suites (engine, sockets, phases, views) + client formatting tests |
| `npm run events:check` | validate `data/events.json` |
| `npm run sim:events -- --try=<event_id>` | fire one event and play out every option (public posts shown with 📣) |
| `npm run sim:events` | one full simulated match with an event feed |
| `npm run sim:events -- --matches=300` | event frequency stats across many seeds |
| `npm run sim:state` | simulate the core economy only (no events) |
| `npm run sim:race -- --matches=100` | play whole seasons and race them; balance per discipline |
| `npm run sim:race -- --show` | print one season's competition, discipline by discipline |

## Repository layout

```
.env.example             passwords + optional SERVER_PORT / SEED   (copy to .env)
data/
  events.json            random event definitions   ← edit to add events
  events.schema.json     schema: editor autocomplete + validation
server/
  src/index.js           entry: config, create server, listen
  src/config.js          environment + .env
  src/app.js             createGameServer(): Express + Socket.IO + match + engine + phase loop
  src/phases.js          round timer: decision → results → next round, GM advance/pause/±time
  src/game/rules.js      all balance numbers + scoring formula   ← edit to tune
  src/game/match.js      match/team state, team decisions, round resolution
  src/game/model.js      data model reference (JSDoc typedefs)
  src/game/race.js       the end-of-season competition + its reveal timeline
  src/game/rng.js        seeded, snapshot-safe RNG
  src/events/engine.js   event engine: rolls, decisions, follow-ups, GM trigger
  src/events/conditions.js  state paths + condition operators
  src/events/effects.js  applying effects, ongoing effects, option previews
  src/events/posts.js    public feed posts
  src/events/validate.js events.json validation
  src/net/auth.js        session tokens, password checks
  src/net/views.js       what each role may see
  src/net/sockets.js     socket requests, role checks, broadcasting
  scripts/               CLI tools (check-events, sim-events, sim-state)
  test/                  node:test suites (engine, sockets, phases, views, race)
client/
  src/net/game.js        useGame() hook: socket, tokens, state, requests
  src/lib/               formatting helpers + tests
  src/components/        shared UI pieces
  src/team/              team dashboard panels (staff, focus, decisions, results, inbox, programme)
  src/race/              the competition screen (shared by teams, GM and projector)
  src/gm/                GM panels (controls, team table, event trigger, feed posts)
  src/views/TeamView.jsx      team client
  src/views/GmView.jsx        Game Master dashboard
  src/views/SpectatorView.jsx projector screen
docs/                    documentation
```
