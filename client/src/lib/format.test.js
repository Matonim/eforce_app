import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeChange, describeEffect, describeModifier, describeOutcome, formatDuration, formatMoney, formatRaceTime, formatSigned, formatSignedMoney, makeLabels } from './format.js';

const labels = makeLabels({
  departments: [
    { id: 'aero', label: 'Aerodynamics' },
    { id: 'business', label: 'Business' },
  ],
});

test('numbers use a real minus sign and thousands separators', () => {
  assert.equal(formatSigned(4), '+4');
  assert.equal(formatSigned(-2.5), '−2.5');
  assert.equal(formatSigned(0), '±0');
  assert.equal(formatMoney(32626), '€32,626');
  assert.equal(formatMoney(-1400), '−€1,400');
  assert.equal(formatSignedMoney(-2500), '−€2,500');
});

test('effect previews read naturally and carry a tone', () => {
  assert.deepEqual(describeEffect({ path: 'budget', op: 'add', value: -2500 }, labels), { text: 'Budget −€2,500', tone: 'down' });
  assert.deepEqual(describeEffect({ path: 'stats.reliability', op: 'add', value: 3 }, labels), { text: 'Reliability +3', tone: 'up' });
  assert.equal(describeEffect({ path: 'budget', op: 'add', range: [1500, 3000] }, labels).text, 'Budget +€1,500 to +€3,000');
  assert.equal(describeEffect({ path: 'personnel.@largest', op: 'add', value: -1 }, labels).text, 'Your largest department −1 person');
  assert.equal(describeEffect({ path: 'budget', op: 'multiply', value: 0.93 }, labels).text, 'Budget −7%');
  assert.equal(
    describeEffect({ path: 'budget', op: 'add', value: -200, per: 'personnel.total', estimate: -2400 }, labels).text,
    'Budget −€200 per team member (≈ −€2,400 for you)',
  );
});

test('ongoing previews include modifiers and per-round effects', () => {
  const lines = describeOutcome(
    {
      effects: [],
      ongoing: { label: 'No backup sensors', rounds: 3, modifiers: { 'output.aero': 0.5 }, perRound: [{ path: 'stats.reliability', op: 'add', value: -1 }] },
    },
    labels,
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'No backup sensors for 3 rounds: Aerodynamics output −50%, Reliability −1 per round');
  assert.equal(lines[0].ongoing, true);
});

test('logged changes show the delta; modifiers treat higher running costs as bad', () => {
  assert.deepEqual(describeChange({ path: 'budget', from: 24000, to: 26898 }, labels), { text: 'Budget +€2,898', tone: 'up' });
  assert.equal(describeChange({ path: 'personnel.aero', from: 3, to: 2 }, labels).text, 'Aerodynamics −1 person');
  assert.equal(describeChange({ path: 'active.x', from: 0, to: 2, label: 'Aero output halved' }, labels).text, 'Aero output halved · 2 rounds');
  assert.equal(describeModifier('upkeep', 1.25, labels).tone, 'down');
  assert.equal(describeModifier('income', 1.2, labels).text, 'Income +20%');
  assert.equal(describeModifier('output.aero', 0, labels).text, 'Aerodynamics output stopped');
});

test('race times keep two decimals and long runs read as minutes', () => {
  assert.equal(formatRaceTime(3.2), '3.20');
  assert.equal(formatRaceTime(74.126), '74.13');
  assert.equal(formatDuration(1334.5), '22:14.50');
  assert.equal(formatDuration(59.996), '1:00.00');
  assert.equal(formatDuration(65.07), '1:05.07');
});
