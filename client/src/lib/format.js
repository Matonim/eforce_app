// Human-readable text for numbers, effect previews, logged changes and modifiers.
// Department names come from the server (state.rules), so nothing here hardcodes game content.

const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const MINUS = '−';

export const formatNumber = (n) => decimal.format(n);
export const sign = (n) => (n > 0 ? '+' : n < 0 ? MINUS : '±');
export const formatSigned = (n) => `${sign(n)}${decimal.format(Math.abs(n))}`;
export const formatMoney = (n) => `${n < 0 ? MINUS : ''}€${whole.format(Math.abs(n))}`;
export const formatSignedMoney = (n) => `${sign(n)}€${whole.format(Math.abs(n))}`;

const hundredths = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Race times and figures always show two decimals, so close results don't look tied: "3.27", "74.10". */
export const formatRaceTime = (n) => hundredths.format(n);
/** A long race time as minutes, e.g. 1334.5 → "22:14.50". */
export function formatDuration(seconds) {
  const total = Math.round(seconds * 100);
  const minutes = Math.floor(total / 6000);
  const rest = total - minutes * 6000;
  return `${minutes}:${String(Math.floor(rest / 100)).padStart(2, '0')}.${String(rest % 100).padStart(2, '0')}`;
}
export const formatPercentChange = (multiplier) => `${sign(multiplier - 1)}${whole.format(Math.abs(multiplier - 1) * 100)}%`;

/** Label helpers bound to this match's department names. */
export function makeLabels(rules) {
  const dept = Object.fromEntries(rules.departments.map((d) => [d.id, d.label]));

  function path(p) {
    if (p === 'budget') return 'Budget';
    if (p === 'stats.performance') return 'Performance';
    if (p === 'stats.reliability') return 'Reliability';
    if (p === 'personnel.total') return 'Team size';
    if (p === 'personnel.@random') return 'A random department';
    if (p === 'personnel.@largest') return 'Your largest department';
    if (p === 'personnel.@smallest') return 'Your smallest department';
    if (p.startsWith('personnel.')) return dept[p.slice('personnel.'.length)] ?? p.slice('personnel.'.length);
    return p;
  }

  function per(p) {
    if (p === 'round') return 'per round number';
    if (p === 'personnel.total') return 'per team member';
    if (p.startsWith('personnel.')) return `per ${path(p)} member`;
    if (p.startsWith('stats.')) return `per ${path(p).toLowerCase()} point`;
    return `per ${p}`;
  }

  function modifier(key) {
    if (key.startsWith('output.')) return `${dept[key.slice('output.'.length)] ?? key} output`;
    if (key === 'gain.performance') return 'Performance gains';
    if (key === 'gain.reliability') return 'Reliability gains';
    if (key === 'income') return 'Income';
    if (key === 'upkeep') return 'Running costs';
    return key;
  }

  return { dept, path, per, modifier };
}

const isMoney = (p) => p === 'budget';
const isPeople = (p) => p.startsWith('personnel.');

function amountText(p, value, { signed = true } = {}) {
  if (isMoney(p)) return signed ? formatSignedMoney(value) : formatMoney(value);
  const text = signed ? formatSigned(value) : formatNumber(value);
  return isPeople(p) ? `${text} ${Math.abs(value) === 1 ? 'person' : 'people'}` : text;
}

// "Good" for the team: more budget, stats and people. Running costs going up (upkeep) is bad.
const toneOf = (value) => (value > 0 ? 'up' : value < 0 ? 'down' : 'flat');

/** A previewed effect (from decision options / active effects) → { text, tone }. */
export function describeEffect(effect, labels) {
  const name = labels.path(effect.path);
  if (effect.op === 'multiply') return { text: `${name} ${formatPercentChange(effect.value)}`, tone: toneOf(effect.value - 1) };
  if (effect.op === 'set') return { text: `${name} set to ${amountText(effect.path, effect.value ?? effect.range?.[0], { signed: false })}`, tone: 'flat' };

  if (effect.range) {
    const [lo, hi] = effect.range;
    const text = `${name} ${amountText(effect.path, lo)} to ${amountText(effect.path, hi)}`;
    return { text: effect.per ? `${text} ${labels.per(effect.per)}` : text, tone: toneOf(lo + hi) };
  }
  if (effect.per) {
    const estimate = Array.isArray(effect.estimate) ? effect.estimate[0] : effect.estimate;
    return {
      text: `${name} ${amountText(effect.path, effect.value)} ${labels.per(effect.per)} (≈ ${amountText(effect.path, estimate)} for you)`,
      tone: toneOf(effect.value),
    };
  }
  return { text: `${name} ${amountText(effect.path, effect.value)}`, tone: toneOf(effect.value) };
}

/** A logged change (event log entries) → { text, tone }. */
export function describeChange(change, labels) {
  if (change.path.startsWith('active.')) {
    return { text: `${change.label} · ${change.to} ${change.to === 1 ? 'round' : 'rounds'}`, tone: 'flat', ongoing: true };
  }
  if (typeof change.from === 'number' && typeof change.to === 'number') {
    const delta = change.to - change.from;
    return { text: `${labels.path(change.path)} ${amountText(change.path, Math.round(delta * 10) / 10)}`, tone: toneOf(delta) };
  }
  return { text: `${labels.path(change.path)}: ${change.to}`, tone: 'flat' };
}

export function describeModifier(key, value, labels) {
  const tone = key === 'upkeep' ? toneOf(1 - value) : toneOf(value - 1);
  return { text: value === 0 ? `${labels.modifier(key)} stopped` : `${labels.modifier(key)} ${formatPercentChange(value)}`, tone };
}

/** All preview lines for an outcome preview ({ effects, ongoing }), in display order. */
export function describeOutcome(preview, labels) {
  const lines = preview.effects.map((e) => describeEffect(e, labels));
  if (preview.ongoing) {
    const { label, rounds, modifiers, perRound = [] } = preview.ongoing;
    const details = [
      ...Object.entries(modifiers ?? {}).map(([k, v]) => describeModifier(k, v, labels).text),
      ...perRound.map((e) => `${describeEffect(e, labels).text} per round`),
    ];
    lines.push({ text: `${label} for ${rounds} ${rounds === 1 ? 'round' : 'rounds'}${details.length ? `: ${details.join(', ')}` : ''}`, tone: 'flat', ongoing: true });
  }
  return lines;
}
