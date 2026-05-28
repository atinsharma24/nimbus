/**
 * @module client
 * @description Drizzle ORM client — singleton database connection pool.
 *
 * PATTERN: Singleton — one connection pool shared across all requests.
 * [INTERVIEW ANCHOR] PostgreSQL default max_connections = 100.
 * A new connection per request exhausts this under load. A pool reuses connections.
 *
 * We import env directly (not from the barrel) to avoid edge runtime issues.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// The connection string comes from the validated env — never hardcoded
// We defer env import to call time so this module is safe to import in tests
function createClient() {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const connectionString = process.env['DATABASE_URL']!;

  if (!connectionString) {
    throw new Error(
      '[nimbus/db] DATABASE_URL is not set. Copy .env.example → .env.local and fill in the value.'
    );
  }

  // prepare: false required for pgvector parameterized queries; max: 10 for the pool
  const pool = postgres(connectionString, { prepare: false, max: 10 });

  return drizzle(pool, { schema });
}

// PATTERN: Singleton via globalThis — survives Next.js hot-reload cycles in development.
// [INTERVIEW ANCHOR] globalThis is the universal global object across Node.js environments.
// Storing the DB client here prevents connection pool exhaustion (max_connections = 100)
// during webpack HMR. In production there are no hot reloads, so this guard is a no-op.
const globalForDb = globalThis as unknown as { _nimbusDb?: ReturnType<typeof createClient> };

export const db = globalForDb._nimbusDb ?? createClient();

if (process.env['NODE_ENV'] !== 'production') {
  globalForDb._nimbusDb = db;
}

// Re-export schema for convenience — callers import from '@nimbus/db' only
export * from './schema';
