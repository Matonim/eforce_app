import { networkInterfaces } from 'node:os';
import { loadConfig } from './config.js';
import { createGameServer } from './app.js';
import { EventDefinitionError } from './events/engine.js';

let config;
let server;
try {
  config = loadConfig();
  server = createGameServer({
    gmPassword: config.gmPassword,
    spectatorPassword: config.spectatorPassword,
    seed: config.seed,
    watchEvents: true, // edits to data/events.json apply live; a broken file keeps the previous definitions
  });
} catch (err) {
  console.error(err instanceof EventDefinitionError ? err.message : `Startup failed: ${err.message}`);
  process.exit(1);
}

console.log(`[events] loaded ${server.engine.list().length} events`);
for (const warning of server.eventsStatus().warnings) console.warn(`[events] ⚠ ${warning}`);

await server.listen(config.port, '0.0.0.0');
console.log(`Server listening on port ${config.port} (seed "${config.seed}") — teams: /  GM: /gm  spectator: /screen`);
for (const addr of lanAddresses()) console.log(`  http://${addr}:${config.port}`);

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}
