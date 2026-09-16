// Session tokens and password checks. Kept outside the match: tokens are secrets and must never
// end up in game state or in any broadcast payload.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { GameError } from '../game/match.js';

/** @typedef {{ role: 'team' | 'gm' | 'spectator', teamId: string | null }} Session */

export function createSessions() {
  /** @type {Map<string, Session>} */
  const byToken = new Map();

  return {
    /** @returns {string} token */
    create(role, teamId = null) {
      const token = randomBytes(24).toString('base64url');
      byToken.set(token, { role, teamId });
      return token;
    },
    /** @returns {Session | null} */
    get(token) {
      return typeof token === 'string' ? (byToken.get(token) ?? null) : null;
    },
    revoke(token) {
      byToken.delete(token);
    },
    /** Revoke every session bound to one of these team ids. */
    revokeTeams(teamIds) {
      const ids = new Set(teamIds);
      for (const [token, session] of byToken) if (ids.has(session.teamId)) byToken.delete(token);
    },
  };
}

/**
 * Timing-safe password check with a per-client lockout after repeated failures.
 * @param {{ maxAttempts?: number, lockMs?: number, now?: () => number }} [options]
 */
export function createPasswordGate({ maxAttempts = 5, lockMs = 60_000, now = Date.now } = {}) {
  /** @type {Map<string, { failures: number, lockedUntil: number }>} */
  const clients = new Map();

  return {
    /** Throws GameError on a wrong password or while the client is locked out. */
    check(clientId, supplied, expected) {
      const record = clients.get(clientId) ?? { failures: 0, lockedUntil: 0 };
      if (record.lockedUntil > now()) {
        const seconds = Math.ceil((record.lockedUntil - now()) / 1000);
        throw new GameError('too_many_attempts', `Too many wrong passwords. Try again in ${seconds}s.`);
      }
      if (samePassword(supplied, expected)) {
        clients.delete(clientId);
        return;
      }
      record.failures += 1;
      if (record.failures >= maxAttempts) {
        record.failures = 0;
        record.lockedUntil = now() + lockMs;
      }
      clients.set(clientId, record);
      throw new GameError('invalid_password', 'Wrong password');
    },
  };
}

function samePassword(supplied, expected) {
  const digest = (value) => createHash('sha256').update(String(value ?? '')).digest();
  return typeof supplied === 'string' && timingSafeEqual(digest(supplied), digest(expected));
}
