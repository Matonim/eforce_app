// Runtime configuration from environment variables, with /.env (repo root) as a fallback.
//
// .env is read here instead of with `node --env-file`: in watch mode Node also watches the .env
// file's whole directory (the repo root), so any change anywhere — even saving data/events.json —
// would restart the server and wipe the in-memory match.
//
// SERVER_PORT rather than PORT: dev tools often inject PORT for the Vite dev server, which would
// make the game server collide with it.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseEnv } from 'node:util';

export const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');

/** Variables already set in the environment win over values in the file. */
export function readEnvFile(file = ENV_FILE, env = process.env) {
  if (!existsSync(file)) return env;
  return { ...parseEnv(readFileSync(file, 'utf8')), ...env };
}

export function loadConfig(env = readEnvFile()) {
  const config = {
    port: Number(env.SERVER_PORT ?? 3000),
    seed: env.SEED ?? 'workshop',
    gmPassword: env.GM_PASSWORD ?? '',
    spectatorPassword: env.SPECTATOR_PASSWORD ?? '',
  };
  const missing = [
    !config.gmPassword && 'GM_PASSWORD',
    !config.spectatorPassword && 'SPECTATOR_PASSWORD',
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Missing ${missing.join(' and ')}. Copy .env.example to .env in the repo root and set them.`);
  }
  if (!Number.isInteger(config.port) || config.port < 0) throw new Error(`Invalid SERVER_PORT "${env.SERVER_PORT}"`);
  return config;
}
