// Validate /data/events.json against the schema and cross-reference rules.
//   npm run events:check
//   npm run events:check -- path/to/other-events.json

import path from 'node:path';
import { EVENTS_FILE, loadAndValidateEvents } from '../src/events/validate.js';

// INIT_CWD is where `npm run` was invoked, so relative paths work from the repo root too.
const cwd = process.env.INIT_CWD ?? process.cwd();
const file = process.argv[2] ? path.resolve(cwd, process.argv[2]) : EVENTS_FILE;
const { data, errors, warnings } = loadAndValidateEvents(file);

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

for (const e of errors) console.log(red(`✗ ${e}`));
for (const w of warnings) console.log(yellow(`⚠ ${w}`));

if (errors.length) {
  console.log(red(`\n${errors.length} error(s) in ${path.relative(cwd, file)}`));
  process.exit(1);
}

const events = data.events;
const count = (pred) => events.filter(pred).length;
console.log(
  green(`✓ ${events.length} events valid`) +
    ` — ${count((e) => (e.scope ?? 'team') === 'team')} team, ${count((e) => e.scope === 'global')} global,` +
    ` ${count((e) => e.decision)} with decisions, ${count((e) => e.enabled === false)} disabled`,
);
