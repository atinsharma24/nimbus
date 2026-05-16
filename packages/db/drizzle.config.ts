import type { Config } from 'drizzle-kit';

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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    url: process.env['DATABASE_URL']!,
  },
} satisfies Config;
