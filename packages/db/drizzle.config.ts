import type { Config } from 'drizzle-kit';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env.local from project root (two directories up from packages/db/)
dotenv.config({ path: path.resolve(process.cwd(), '../../.env.local') });

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('[drizzle.config] DATABASE_URL not found. Is .env.local set up?');
}

/**
 * drizzle-kit configuration — used by CLI commands:
 *   pnpm db:push      → push schema changes to DB without generating migration files
 *   pnpm db:generate  → generate SQL migration files from schema diff
 *   pnpm db:studio    → open Drizzle Studio (visual DB browser)
 *
 * [INTERVIEW ANCHOR] `push` vs `generate`:
 * - push: fast, no migration history — use in local dev
 * - generate: produces versioned .sql files — use before production deploys
 */
export default {
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
} satisfies Config;
