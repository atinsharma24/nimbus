# Day 01 — Foundations Audit & Environment Bootstrap

## Context

The skeleton of Project Nimbus exists: interfaces, schema, db client, and config are scaffolded. Before writing a single line of business logic, we must verify the foundation is sound. A bug in `client.ts` means every DB call in the project is silently broken. A wrong model string in `constants.ts` means the embedder will 500 on the first real call. Day 01 exists so we never build on sand.

This day also runs the Session Initialization Checklist (rules.md §10), fixes all issues surfaced in the Task 1 audit, and leaves us with a green local environment ready for Day 02.

---

## Findings from Task 1 Audit

### Finding 1 — `packages/db/src/client.ts`: Missing `globalThis` hot-reload guard

**What's wrong:** In Next.js 14 dev mode, `webpack` hot-reloads modules on every file save. The current `createClient()` is called at module load time, so **every hot reload creates a new `postgres` connection pool**. With `max: 10` per pool, you'll exhaust PostgreSQL's 100 default `max_connections` in ~10 saves. You'll see `"sorry, too many clients already"` errors mid-session.

**Why it matters:** This is a dev-only footgun that won't bite in production (no hot reloads there), but it will make your local dev environment unreliable.

**Pattern:** The fix is a `globalThis` guard — a standard Next.js pattern. The singleton is stored on the Node.js global object, which survives hot reloads. The module-level reference just points to it.

```diff
// packages/db/src/client.ts

-// Export the singleton client
-// Trade-off: module-level singleton works well for Next.js server-side code,
-// but will need a guard for hot-reload in development (Next.js handles this via globalThis)
-export const db = createClient();
+// PATTERN: Singleton via globalThis — survives Next.js hot-reload cycles.
+// [INTERVIEW ANCHOR] globalThis is the universal global object across Node.js
+// and browser environments. Using it for the DB client prevents connection pool
+// exhaustion (PostgreSQL default max_connections = 100) during webpack HMR.
+const globalForDb = globalThis as unknown as { _nimbusDb?: ReturnType<typeof createClient> };
+
+export const db = globalForDb._nimbusDb ?? createClient();
+
+if (process.env['NODE_ENV'] !== 'production') {
+  globalForDb._nimbusDb = db;
+}
```

---

### Finding 2 — `packages/db/src/schema.ts`: `init.sql` volume mount path is incorrect in `docker-compose.yml`

**What's wrong:** In `docker-compose.yml` line 30:
```yaml
- ./infra/init.sql:/docker-entrypoint-initdb.d/01-init.sql
```
The path `./infra/init.sql` is relative to the `docker-compose.yml` file itself (which lives in `infra/`), so Docker resolves it as `infra/infra/init.sql` — a path that does not exist. The `CREATE EXTENSION vector;` never runs, meaning `pgvector` is not enabled in the DB, meaning all vector operations will fail.

**The schema.ts file itself is correct** — the `vector(name, dimensions)` custom type, serializer (`[0.1,0.2,...]`), and deserializer (`.slice(1,-1).split(',').map(Number)`) are all correct pgvector wire format.

```diff
// infra/docker-compose.yml line 30

-      - ./infra/init.sql:/docker-entrypoint-initdb.d/01-init.sql
+      - ./init.sql:/docker-entrypoint-initdb.d/01-init.sql
```

---

### Finding 3 — `packages/config/src/env.ts`: Two issues

**Issue A — Blows up in test environments:**  
The current `envSchema.parse(...)` call runs at module import time. Any `import { env } from '@nimbus/config'` in a Vitest test will throw because `GROQ_API_KEY` and `DATABASE_URL` are not set in the test environment. This makes the env module impossible to import in tests, which blocks testing any module that transitively imports it.

**Fix:** Use `safeParse` + conditional throw, and add a `skipValidation` escape hatch via a `SKIP_ENV_VALIDATION` env variable (a well-known Next.js pattern).

**Issue B — Edge Runtime incompatibility:**  
The `typeof process !== 'undefined'` guard is insufficient for Next.js Edge Runtime. In Edge Runtime, `process` exists but `process.env` may not contain server-side variables. The safer guard is `process.env.NEXT_RUNTIME !== 'edge'`.

```diff
// packages/config/src/env.ts

-// This runs at module load time — if validation fails, process.exit() equivalent
-// Only validate in non-test environments to allow unit tests without a real DB
-export const env = envSchema.parse(
-  typeof process !== 'undefined' ? process.env : {}
-);
+// PATTERN: Fail Fast with escape hatch for test environments.
+// Set SKIP_ENV_VALIDATION=1 in vitest.config.ts to bypass validation during unit tests.
+// [INTERVIEW ANCHOR] Failing at startup (not at first API call) is the "Fail Fast" principle —
+// the same reason Java throws NoClassDefFoundError rather than silently returning null.
+const isEdgeRuntime = typeof process !== 'undefined' && process.env['NEXT_RUNTIME'] === 'edge';
+const skipValidation = typeof process !== 'undefined' && process.env['SKIP_ENV_VALIDATION'] === '1';
+
+const parsed = skipValidation || isEdgeRuntime
+  ? ({ success: true, data: process.env } as z.SafeParseSuccess<Env>)
+  : envSchema.safeParse(process.env);
+
+if (!parsed.success) {
+  console.error('[nimbus/config] ❌ Invalid environment variables:');
+  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
+  throw new Error('[nimbus/config] Invalid environment variables — see above for details.');
+}
+
+export const env = parsed.data as Env;
```

---

### Finding 4 — `packages/config/src/constants.ts`: Wrong embedding model string

**What's wrong:** `GROQ_EMBEDDING_MODEL = 'text-embedding-ada-002'` is an **OpenAI model string**. Groq does not offer an embedding endpoint as of 2025.

**Why it matters:** If any code uses this constant to make a Groq API call for embeddings, it will get an API 404. This is a silent misconfiguration that would surface only at runtime, not at compile time.

**Fix based on Decision:** Per `overview.md`, the default decision is **Option A: Ollama with `nomic-embed-text`**. The constant is renamed and corrected. If you override to Option B (OpenAI), change this string to `text-embedding-3-small` and swap the `EMBEDDING_DIM` to 1536.

```diff
// packages/config/src/constants.ts

-// Groq model identifiers — named so we update once, not across every file
 export const GROQ_CHAT_MODEL = 'llama-3.3-70b-versatile' as const;
-export const GROQ_EMBEDDING_MODEL = 'text-embedding-ada-002' as const;
+
+// [DECISION REQUIRED] Embedding provider is NOT Groq (Groq has no embedding endpoint).
+// Default: Ollama local embeddings with nomic-embed-text (768-dim, free, ~30ms on M-series).
+// Override: set to 'text-embedding-3-small' and change EMBEDDING_DIM to 1536 if using OpenAI.
+export const OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text' as const;
+export const OLLAMA_BASE_URL = 'http://localhost:11434' as const;
```

```diff
// Also update EMBEDDING_DIM to match nomic-embed-text output dimension

-export const EMBEDDING_DIM = 1536;
+// [DECISION REQUIRED] Must match the embedding model output dimension AND the pgvector column.
+// nomic-embed-text → 768 | text-embedding-3-small (OpenAI) → 1536
+// Changing this after documents are indexed requires full re-embedding of all data.
+export const EMBEDDING_DIM = 768;
```

> **⚠️ Schema impact:** Changing `EMBEDDING_DIM` from 1536 → 768 requires the `chunks.embedding` column to be `vector(768)` in the DB. Since no data exists yet, `pnpm db:push` handles this automatically. If you later switch providers, you must `DROP` and recreate the column or run a migration.

---

## [AGENT TASKS]

### Step 1: Fix `infra/docker-compose.yml`

File: `infra/docker-compose.yml`  
Apply the init.sql path fix (Finding 2 above).

### Step 2: Fix `packages/db/src/client.ts`

File: `packages/db/src/client.ts`  
Apply the `globalThis` guard (Finding 1 above).

### Step 3: Fix `packages/config/src/env.ts`

File: `packages/config/src/env.ts`  
Apply the `safeParse` + skip validation fix (Finding 3 above).

### Step 4: Fix `packages/config/src/constants.ts`

File: `packages/config/src/constants.ts`  
Apply the embedding model + dimension fixes (Finding 4 above).

### Step 5: Update `packages/db/src/schema.ts` embedding dimension

File: `packages/db/src/schema.ts`  
Change `vector('embedding', 1536)` → `vector('embedding', 768)` to match new `EMBEDDING_DIM`.

### Step 6: Add `SKIP_ENV_VALIDATION=1` to vitest config

Create `packages/rag-core/vitest.config.ts` with this env variable set so tests can import `@nimbus/config` without a live env.

### Verification commands (run in order):
```bash
# 1. Confirm the docker-compose.yml fix resolves the path
grep "init.sql" infra/docker-compose.yml
# Expected: ./init.sql:/docker-entrypoint-initdb.d/01-init.sql (no infra/ prefix)

# 2. TypeScript check — no errors across the monorepo
pnpm typecheck

# 3. Run the placeholder test to confirm Vitest wiring is still intact
pnpm test
# Expected: ✓ @nimbus/rag-core — placeholder > test suite is wired up correctly
```

---

## [MY TASKS]

- [ ] **Start OrbStack / Docker Desktop** — the daemon is not running (`docker: Cannot connect to the Docker daemon`). Start OrbStack then verify: `docker ps`
- [ ] **Start the database:** `cd infra && docker compose up -d`  
  Expected output: `Container nimbus_postgres Started`
- [ ] **Create `.env.local`:** `cp .env.example .env.local`  
  Then fill in `GROQ_API_KEY` (get from https://console.groq.com) and `DATABASE_URL=postgresql://nimbus:nimbus@localhost:5432/nimbus_db`
- [ ] **Install Ollama** (if choosing Option A): `brew install ollama && ollama pull nomic-embed-text`  
  Verify: `ollama list` should show `nomic-embed-text`
- [ ] **Run Drizzle push to apply schema:** `pnpm db:push`  
  Expected: Drizzle confirms tables `documents` and `chunks` created
- [ ] **Review the 5 diffs above** before the agent applies any fixes
- [ ] **Confirm embedding provider decision** (Option A: Ollama or Option B: OpenAI) before Day 03

---

## Definition of Done

- [ ] `docker ps` shows `nimbus_postgres` with status `healthy`
- [ ] `.env.local` exists with non-empty `GROQ_API_KEY` and `DATABASE_URL`
- [ ] `pnpm db:push` exits 0 — tables `documents` and `chunks` confirmed in DB
- [ ] `pnpm typecheck` exits 0 with no TypeScript errors
- [ ] `pnpm test` exits 0 — placeholder test passes
- [ ] `packages/db/src/client.ts` contains the `globalThis._nimbusDb` guard
- [ ] `packages/config/src/constants.ts` does NOT contain `text-embedding-ada-002`
- [ ] `packages/config/src/env.ts` uses `safeParse` and respects `SKIP_ENV_VALIDATION`
- [ ] `infra/docker-compose.yml` init.sql path is `./init.sql` (not `./infra/init.sql`)
- [ ] Embedding dimension decision is confirmed and applied consistently in `constants.ts` and `schema.ts`
