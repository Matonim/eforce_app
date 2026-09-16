// ============================================================================
//  GAME RULES & TUNING
//  Every balance number and the scoring formula live in this one file.
//  Events are NOT defined here — see /data/events.json.
// ============================================================================

export const DEPARTMENTS = ['aero', 'chassis', 'powertrain', 'electronics', 'business', 'driverless'];
export const STATS = ['performance', 'reliability', 'autonomy'];

// Names and one-line descriptions shown on the team screen.
export const DEPARTMENT_INFO = {
  aero: { label: 'Aerodynamics', description: 'Wings, diffuser, downforce' },
  chassis: { label: 'Chassis', description: 'Frame, suspension, vehicle dynamics' },
  powertrain: { label: 'Powertrain', description: 'Motors, inverters, accumulator' },
  electronics: { label: 'Electronics', description: 'Wiring, sensors, control software' },
  business: { label: 'Business', description: 'Sponsors, cost report, business plan' },
  driverless: { label: 'Driverless & Software', description: 'Autonomous stack: perception, planning, control', requiresAutonomous: true },
};

// The driverless programme: optional, expensive, and the only way to score in the DV disciplines.
export const AUTONOMOUS = {
  setupCost: 35000, // one-off when the programme starts (sensors, compute, safety system)
  perRoundCost: 4000, // running cost while it is active, × the location's cost level
  incomeMultiplier: 1.2, // industry interest: sponsors pay more for a driverless programme
  autonomyPerDriverless: 1.1, // autonomy per unit of driverless output per round (see SEASON.staffExponent)
  autonomyPerElectronics: 0.15, // electronics helps the autonomous stack
};

// What teams see about themselves during the match (other teams never see these numbers).
export const VISIBILITY = {
  ownScoreDuringMatch: false, // the competition decides the winner; teams never see a season score
};

// ---- Season shape --------------------------------------------------------------

export const SEASON = {
  // Every per-round number in this file (stat contributions, income, costs) is tuned for a season
  // of this many rounds. A match with fewer rounds makes each round count for proportionally more,
  // so the season ends in the same place whatever length the GM picks.
  referenceRounds: 14,
  // Department output = members ^ staffExponent. The 20th engineer adds less than the 5th, so a
  // 140-person team is stronger than a 30-person one without being five times stronger.
  staffExponent: 0.65,
};

export const MATCH_DEFAULTS = {
  totalRounds: 14,
  decisionSeconds: 75,
  resolutionSeconds: 12, // how long round results are shown before the next decision phase
  maxTeams: 12,
};

// What the GM may set in the lobby (gm:configure). All whole numbers.
export const MATCH_LIMITS = {
  totalRounds: { min: 1, max: 30 },
  decisionSeconds: { min: 10, max: 600 },
  resolutionSeconds: { min: 3, max: 120 },
};

// How far the GM can move the current phase timer in one step (gm:addTime), in seconds.
export const MAX_TIME_ADJUST_SECONDS = 600;

// Live GM fixes: the largest budget the GM can set on a team, and the longest feed announcement.
export const MAX_BUDGET_EDIT = 10_000_000;
export const ANNOUNCEMENT_MAX_LENGTH = 280;

// ---- Starting conditions (randomised per team with the match seed) ---------

export const SETUP = {
  // Budget = members × a random amount per member, rounded to `step` and kept within min–max.
  // Bigger teams tend to have bigger budgets, but some are well funded for their size and others
  // are not — every team starts with a different problem.
  budget: { min: 80000, max: 400000, perMember: { min: 1800, max: 3800 }, step: 5000 },
  headcount: { min: 30, max: 140 },
  minPerDepartment: 3,
  // Departments nobody starts in: staffed only once the team opts into that programme.
  optionalDepartments: ['driverless'],
  stats: {
    performance: { min: 5, max: 15 },
    reliability: { min: 5, max: 15 },
    autonomy: { min: 0, max: 0 }, // nobody starts with an autonomous system
  },
  focusPerformance: 50, // 0 = all-in reliability, 100 = all-in performance
  // costLevel scales everything a team pays (members, the driverless programme); sponsorLevel scales
  // sponsorship income. Expensive places tend to have richer sponsors, but not enough to make up for it.
  locations: [
    { id: 'prague', name: 'Prague', country: 'CZ', costLevel: 0.8, sponsorLevel: 0.85 },
    { id: 'munich', name: 'Munich', country: 'DE', costLevel: 1.2, sponsorLevel: 1.2 },
    { id: 'stuttgart', name: 'Stuttgart', country: 'DE', costLevel: 1.15, sponsorLevel: 1.2 },
    { id: 'karlsruhe', name: 'Karlsruhe', country: 'DE', costLevel: 1.1, sponsorLevel: 1.05 },
    { id: 'delft', name: 'Delft', country: 'NL', costLevel: 1.2, sponsorLevel: 1.15 },
    { id: 'eindhoven', name: 'Eindhoven', country: 'NL', costLevel: 1.15, sponsorLevel: 1.1 },
    { id: 'graz', name: 'Graz', country: 'AT', costLevel: 1.05, sponsorLevel: 1.05 },
    { id: 'zurich', name: 'Zurich', country: 'CH', costLevel: 1.45, sponsorLevel: 1.25 },
    { id: 'gothenburg', name: 'Gothenburg', country: 'SE', costLevel: 1.25, sponsorLevel: 1.1 },
    { id: 'turin', name: 'Turin', country: 'IT', costLevel: 1.0, sponsorLevel: 1.05 },
    { id: 'barcelona', name: 'Barcelona', country: 'ES', costLevel: 0.95, sponsorLevel: 0.95 },
    { id: 'budapest', name: 'Budapest', country: 'HU', costLevel: 0.75, sponsorLevel: 0.8 },
    { id: 'warsaw', name: 'Warsaw', country: 'PL', costLevel: 0.75, sponsorLevel: 0.8 },
    { id: 'loughborough', name: 'Loughborough', country: 'GB', costLevel: 1.25, sponsorLevel: 1.1 },
  ],
  colors: ['#e10600', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#d81b60', '#7cb342', '#5e35b1', '#6d4c41', '#90a4ae'],
};

export const STAT_LIMITS = {
  performance: { min: 0, max: 100 },
  reliability: { min: 0, max: 100 },
  autonomy: { min: 0, max: 100 },
};

// ---- Per-round production ----------------------------------------------------

// Stat points per unit of department output per round (output = members ^ SEASON.staffExponent),
// before focus, modifiers and headroom. Gains shrink as a stat approaches its maximum:
//   gain = Σ output × contribution × focus × modifiers × (1 − stat/100) × season scale
export const CONTRIBUTION = {
  aero: { performance: 0.33, reliability: 0.05, autonomy: 0 },
  chassis: { performance: 0.2, reliability: 0.26, autonomy: 0 },
  powertrain: { performance: 0.26, reliability: 0.15, autonomy: 0 },
  electronics: { performance: 0.1, reliability: 0.46, autonomy: AUTONOMOUS.autonomyPerElectronics },
  business: { performance: 0, reliability: 0, autonomy: 0 },
  driverless: { performance: 0, reliability: 0.05, autonomy: AUTONOMOUS.autonomyPerDriverless },
};

// The focus slider only trades performance against reliability; autonomy is unaffected by it.
export const FOCUSED_STATS = ['performance', 'reliability'];

// The focus slider scales stat gains linearly between these multipliers.
// focus 0 → min, focus 100 → max. At 50/50 both stats get 1.0x.
export const FOCUS_MULTIPLIER = { min: 0.5, max: 1.5 };

export const ECONOMY = {
  baseIncome: 3000, // university funding per round
  // Sponsorship per unit of business output per round (output = members ^ staffExponent, so the
  // sponsor market saturates), × the location's sponsor level.
  sponsorshipPerOutput: 2300,
  // Students aren't paid. Each member still costs the team money every round:
  // travel and accommodation for events, safety gear, tools and workshop consumables.
  // × the location's cost level.
  costPerMember: 300,
};

// ---- Random events ----------------------------------------------------------

export const EVENT_ROLLS = {
  firstRound: 1, // no random events before this round
  teamEventChance: 0.45, // chance each team rolls one team-scope event per round (≈ 6 per 14-round season)
  globalEventChance: 0.15, // chance one global event fires per round
  maxPendingDecisions: 1, // random decision events skip teams already holding this many
  rollAfterFollowUp: false, // false: a team that got a guaranteed follow-up skips its random roll that round
};

// ---- Scoring ----------------------------------------------------------------

// The season score is only an indicator for the GM (teams don't see it); the competition decides the winner.
export const SCORE_WEIGHTS = {
  performance: 1.0,
  reliability: 0.6,
  budgetPer10k: 1.0, // points per €10,000 left over
  debtPer10k: 2.0, // points lost per €10,000 in debt
};

/** @param {import('./model.js').Team} team */
export function computeScore(team) {
  const { performance, reliability } = team.stats;
  const W = SCORE_WEIGHTS;
  // An unreliable car doesn't finish: reliability scales how much performance counts (50%–100%).
  const finishFactor = 0.5 + 0.5 * (reliability / STAT_LIMITS.reliability.max);
  const money = team.budget >= 0 ? W.budgetPer10k * (team.budget / 10000) : W.debtPer10k * (team.budget / 10000);
  const score = W.performance * performance * finishFactor + W.reliability * reliability + money;
  return Math.round(score * 10) / 10;
}

// ============================================================================
//  THE COMPETITION (end of season)
//  A Formula Student event worth 1000 points: three static disciplines judged on
//  the team's work, six dynamic ones driven on track, plus efficiency.
// ============================================================================

// Each discipline scores a "capability" from the team's final state. Keys are:
//   performance / reliability / autonomy   the stat (0–100)
//   aero / chassis / … / driverless        department output (members ^ SEASON.staffExponent)
//   budgetKept                             budget now ÷ starting budget, 0–1.5 (financial handling)
//   incomePer10k                           income earned over the season, per €10,000
// Capability is capped at 100.
//
// Static:  points = max × score / best score          (the best team takes full points)
// Timed:   `bestTime` is the typical winning time, not a fixed one. Each discipline gets its own
//          competition-day pace (track, weather, wind: bestTime × 1 ± dayVariation), the best car in
//          the field runs at that pace and the rest are behind it in proportion to the capability gap.
//          Every run then loses a random 0…runVariation on top (a missed shift, a wide line, a cone):
//            time = bestTime × dayPace × (1 + spread × (topCapability − capability)/100) × runLoss
//          points = max × (Tcut/T − 1) / (Tcut/Tbest − 1), where Tcut = cutoff × Tbest, so a car
//          1.5× slower than the winner (a full 100 capability points behind) scores zero.
export const RACE = {
  cutoff: 1.5,
  spread: 0.5,
  dayVariation: 0.04, // the day's pace moves each discipline's winning time by up to ±4%
  runVariation: 0.03, // each car's run loses up to 3% against its potential
  finalists: 4, // static disciplines: the top 4 go through to the finals
  finalsSwing: 0.08, // how much a finals presentation can move a score, ±8%
  endurance: {
    laps: 18,
    lapVariation: 0.015, // lap-to-lap noise (±), on top of the day's pace
    degradation: 0.004, // extra lap time per lap for an unreliable car
    // Per-lap failure chance = dnfBase × e^(−dnfDecay × reliability). Over the 18 laps that is
    // roughly 85% of cars retiring at reliability 0, 47% at 20, 20% at 40, 8% at 60 and 1% at 100 —
    // enough drama that reliability matters, without turning 250 points into a coin toss.
    dnfBase: 0.10,
    dnfDecay: 0.052,
    dnfReasons: [
      { text: 'accumulator overheated and shut down', department: 'electronics' },
      { text: 'inverter fault, the motor cut out', department: 'powertrain' },
      { text: 'rear wishbone failed over the kerbs', department: 'chassis' },
      { text: 'front wing mount broke loose', department: 'aero' },
      { text: 'low-voltage wiring loom shorted', department: 'electronics' },
      { text: 'driveshaft let go on corner exit', department: 'powertrain' },
      { text: 'driver went off and beached the car', department: null },
    ],
  },
  disciplines: [
    {
      id: 'design',
      name: 'Engineering Design',
      type: 'static',
      points: 150,
      blurb: 'Judges grill the team on how innovative and well-engineered the car is.',
      capability: { performance: 0.5, aero: 1.3, chassis: 1.3, powertrain: 1.3, electronics: 1.3, driverless: 1.0, autonomy: 0.2 },
    },
    {
      id: 'cost',
      name: 'Cost & Manufacturing',
      type: 'static',
      points: 100,
      blurb: 'How well the team ran its money and its manufacturing.',
      capability: { budgetKept: 50, business: 2, reliability: 0.3 },
    },
    {
      id: 'business',
      name: 'Business Plan',
      type: 'static',
      points: 75,
      blurb: 'Selling the idea: pitching, sponsors and industry connections.',
      capability: { business: 7, incomePer10k: 0.5, autonomy: 0.15 },
    },
    {
      id: 'acceleration',
      name: 'Acceleration',
      type: 'timed',
      points: 50,
      unit: 's',
      bestTime: 3.2,
      blurb: '75 m from a standing start: weight, aero and power.',
      capability: { chassis: 3, aero: 2.2, powertrain: 3, performance: 0.35 },
    },
    {
      id: 'acceleration_dv',
      name: 'Acceleration (Driverless)',
      type: 'timed',
      points: 75,
      unit: 's',
      bestTime: 3.2,
      driverless: true,
      blurb: 'The same run with nobody in the cockpit.',
      capability: { chassis: 2.2, aero: 1.5, powertrain: 2.2, performance: 0.25, autonomy: 0.45 },
    },
    {
      id: 'skidpad',
      name: 'Skidpad',
      type: 'timed',
      points: 50,
      unit: 's',
      bestTime: 4.6,
      blurb: 'A figure of eight: suspension and grip.',
      capability: { chassis: 5, aero: 1.5, performance: 0.3 },
    },
    {
      id: 'skidpad_dv',
      name: 'Skidpad (Driverless)',
      type: 'timed',
      points: 75,
      unit: 's',
      bestTime: 4.8,
      driverless: true,
      blurb: 'Constant radius, driven by the autonomous system.',
      capability: { chassis: 3.5, aero: 1, performance: 0.25, autonomy: 0.5 },
    },
    {
      id: 'autocross',
      name: 'Autocross',
      type: 'timed',
      points: 100,
      unit: 's',
      bestTime: 72,
      blurb: 'One flying lap: the whole car and the driver.',
      capability: { performance: 0.6, chassis: 2.2, aero: 2.2, powertrain: 1.5 },
    },
    {
      id: 'endurance',
      name: 'Endurance',
      type: 'endurance',
      points: 250,
      unit: 's',
      bestTime: 74, // typical best lap
      blurb: '18 laps. Pace matters, finishing matters more.',
      capability: { performance: 0.5, chassis: 1.9, aero: 1.5, powertrain: 1.5, reliability: 0.2 },
    },
    {
      id: 'efficiency',
      name: 'Efficiency',
      type: 'efficiency',
      points: 75,
      unit: 'kWh',
      bestTime: 18.5, // typical best figure: energy used over the endurance run
      blurb: 'Energy used over endurance. Finishers only.',
      capability: { powertrain: 3, electronics: 3, performance: 0.3 },
    },
  ],
};

/** Total points on offer: 1000 if the table above is complete. */
export const RACE_TOTAL_POINTS = RACE.disciplines.reduce((sum, d) => sum + d.points, 0);
