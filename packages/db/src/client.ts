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

  // postgres-js connection pool — max 10 connections (appropriate for a single-server app)
  const pool = postgres(connectionString, { max: 10 });

  return drizzle(pool, { schema });
}

// Export the singleton client
// Trade-off: module-level singleton works well for Next.js server-side code,
// but will need a guard for hot-reload in development (Next.js handles this via globalThis)
export const db = createClient();

// Re-export schema for convenience — callers import from '@nimbus/db' only
export * from './schema';
