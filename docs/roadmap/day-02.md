# Day 02 — Database Repository Layer

## Context

Day 01 fixed all foundation issues: the DB client is hot-reload safe, the env module handles test environments correctly, the embedding model is correctly identified, and Docker/Drizzle are confirmed healthy. The schema tables (`documents`, `chunks`) exist in Postgres.

Day 02 builds the **Repository layer** — the single file that owns all database access for the project. Nothing outside `packages/db` ever writes SQL or Drizzle queries directly. This is the Repository Pattern: a typed interface between business logic and the database, so the calling code never needs to know whether it's talking to Postgres, SQLite, or a mock.

This day unlocks Day 03: the Embedder needs to be able to save chunks, and the Retriever needs to be able to query them.

---

## [AGENT TASKS]

### Concept: Repository Pattern

The Repository Pattern (from Eric Evans' Domain-Driven Design) defines a collection-like interface for accessing domain objects. The caller sees functions like `createDocument(data)` or `findChunksByDocumentId(id)` — they never see a Drizzle query. This means:
1. Business logic in `rag-core` is testable without a real database (pass a mock repository).
2. If we ever swap Drizzle for a different ORM, only `repository.ts` changes.

### File to Create: `packages/db/src/repository.ts`

**Function signatures (implement exactly these):**

```typescript
// Document operations
export async function createDocument(data: NewDocumentRow): Promise<Result<DocumentRow>>
export async function getDocumentById(id: string): Promise<Result<DocumentRow | null>>
export async function updateDocumentStatus(
  id: string,
  status: DocumentRow['status'],
  errorMessage?: string
): Promise<Result<DocumentRow>>
export async function listDocuments(): Promise<Result<DocumentRow[]>>
export async function deleteDocument(id: string): Promise<Result<void>>

// Chunk operations
export async function insertChunks(chunks: NewChunkRow[]): Promise<Result<ChunkRow[]>>
export async function findSimilarChunks(
  queryEmbedding: number[],
  topK: number,
  minScore?: number
): Promise<Result<Array<ChunkRow & { score: number }>>>
export async function deleteChunksByDocumentId(documentId: string): Promise<Result<void>>
```

**Key implementation detail for `findSimilarChunks`:**  
pgvector cosine distance with the `<=>` operator. Drizzle does not have a native pgvector helper, so use `sql` tagged template:

```typescript
import { sql } from 'drizzle-orm';

// cosine distance (lower = more similar), so ORDER BY ASC
// Convert to similarity score: score = 1 - distance
const rows = await db.execute(sql`
  SELECT
    id, document_id, content, chunk_index, created_at,
    1 - (embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector) AS score
  FROM chunks
  ORDER BY embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector ASC
  LIMIT ${topK}
`);
```

> **[INTERVIEW ANCHOR]** The `<=>` operator is pgvector's cosine distance operator (not similarity). Distance ∈ [0, 2]; similarity = 1 − distance ∈ [−1, 1]. For normalized vectors (L2-normalized embeddings), cosine similarity ∈ [0, 1], where 1 = identical.

**Every function must:**
- Return `Result<T>` — wrap all Drizzle calls in `try/catch` and return `{ ok: false, error }` on failure
- Have a `console.time` / `console.timeEnd` pair gated on `NODE_ENV === 'development'` (rules.md §3.4)
- Have a complete JSDoc block

### Update `packages/db/src/index.ts`

Export the new repository functions:
```typescript
export * from './repository';
```

### Verification commands:
```bash
# 1. TypeScript check on the db package specifically
pnpm --filter @nimbus/db exec tsc --noEmit
# Expected: exits 0

# 2. Full monorepo typecheck
pnpm typecheck
# Expected: exits 0
```

---

## [MY TASKS]

- [ ] **Confirm database is running** before the agent runs `pnpm typecheck`:  
  `docker ps | grep nimbus_postgres` → should show `healthy`
- [ ] **Review the repository.ts diff** — pay attention to:
  - The `<=>` operator SQL — understand why we use raw `sql` tagged template instead of a Drizzle method
  - The `score = 1 - distance` transform — understand why this is necessary
  - The error wrapping pattern in each function
- [ ] **Ask yourself:** "Could I rewrite `findSimilarChunks` from memory?" If no, re-read the pgvector section of `architecture.md` and this file before Day 03.

---

## Definition of Done

- [ ] `packages/db/src/repository.ts` exists with all 8 functions
- [ ] Every function returns `Result<T>` — no raw throws
- [ ] `findSimilarChunks` uses the `<=>` cosine distance operator
- [ ] Every function has a JSDoc block with `@param` and `@returns`
- [ ] `pnpm typecheck` exits 0 with no errors
- [ ] `packages/db/src/index.ts` exports all repository functions
