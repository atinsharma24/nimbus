# Day 04 — Retriever + Reranker

## Context

Day 03 gave us the ingestion half: documents can now be chunked and embedded. Day 04 implements the query half's first two stages: retrieving semantically similar chunks from the database, then reranking them for precision before handing them to the LLM.

These two stages together are the "retrieval" in RAG. The retriever is fast but approximate (HNSW ANN). The reranker is slower but precise. Together they implement the two-stage retrieval pattern used in production search engines.

---

## [AGENT TASKS]

### Stage 3: `packages/rag-core/src/retriever.ts` — PgVectorRetriever

**Concept:** Given a query embedding (a vector), find the top-K chunks in the database whose embeddings are closest in vector space. This is approximate nearest-neighbor (ANN) search — the HNSW index makes it O(log n) instead of brute-force O(n × dim).

**Pattern:** Implements the `Retriever` interface from `interfaces.ts`. Strategy Pattern: a `HybridRetriever` (dense + BM25 keyword) would be a drop-in upgrade with no changes to the pipeline orchestrator.

**Key detail:** The retriever calls `findSimilarChunks` from the repository — it does NOT write any Drizzle queries itself. This enforces the Repository Pattern and the Hexagonal Architecture rule (rules.md §4.5): business logic in `rag-core` has zero DB imports.

```typescript
// packages/rag-core/src/retriever.ts
import { findSimilarChunks } from '@nimbus/db';
import type { Retriever, RetrievalOptions } from './interfaces';
import type { Result, RetrievedChunk } from '@nimbus/config';

export class PgVectorRetriever implements Retriever {
  async retrieve(
    queryEmbedding: number[],
    options?: Partial<RetrievalOptions>
  ): Promise<Result<RetrievedChunk[]>>
}
```

> **[INTERVIEW ANCHOR]** HNSW (Hierarchical Navigable Small World) is a graph-based ANN algorithm. It builds a multi-layer graph where each layer is a progressively coarser approximation of the data distribution. Search starts at the top (sparse) layer and greedily descends, narrowing candidates. This gives O(log n) average-case lookup — the same asymptotic complexity as a balanced BST, but in high-dimensional space.

**Latency guard:** `console.time('[retriever] pgvector ANN')` — flag if > 20ms.

**Test file: `packages/rag-core/__tests__/retriever.test.ts`**

Mock `@nimbus/db` (`vi.mock('@nimbus/db', ...)`) so no real DB connection is needed.

Test cases:
1. `retrieve(embedding, { topK: 5 })` → calls `findSimilarChunks` with topK=5 and returns its result
2. `findSimilarChunks` returns error → `retrieve` propagates `Result.error`
3. `minScore` filter: chunks with score < minScore are filtered out before returning
4. Returns chunks in descending score order

---

### Stage 4: `packages/rag-core/src/reranker.ts` — HeuristicReranker

**Concept:** The retriever returns top-K candidates ranked by vector similarity. The reranker applies a second scoring pass to improve precision. The HeuristicReranker is a fast, zero-ML-inference approach that re-weights chunks using two signals:
- **Similarity score** (from pgvector) — semantic relevance
- **Inverse chunk position** — earlier chunks in a document are usually more important (document summary, title, abstract)

**Why rerank at all?** Vector similarity is a proxy for relevance, not a perfect measure. A chunk that contains the exact query keyword might have a slightly lower cosine similarity than a thematically related chunk that doesn't answer the question. The reranker corrects for this.

**Pattern:** Implements the `Reranker` interface. The CrossEncoderReranker (upgrade path) uses a neural model that reads both the query and chunk together — more accurate but adds ~100–200ms latency (over budget). Document this as a comment.

**Scoring formula:**
```
finalScore = (0.7 × similarityScore) + (0.3 × (1 / (chunkIndex + 1)))
```
Where `chunkIndex + 1` prevents division by zero and gives chunkIndex=0 a bonus of `0.3 × 1.0 = 0.3`.

**Function signature:**
```typescript
export class HeuristicReranker implements Reranker {
  async rerank(
    query: string,
    chunks: RetrievedChunk[]
  ): Promise<Result<RetrievedChunk[]>>
}
```

**Note:** The `query` parameter is accepted for interface compliance but unused in the heuristic implementation. When `CrossEncoderReranker` is added, it will use the query to score relevance. Document this intent in a comment.

**Test file: `packages/rag-core/__tests__/reranker.test.ts`**

Test cases:
1. Chunks are returned sorted by `finalScore` descending
2. A chunk with high `score` but high `chunkIndex` scores lower than a chunk with moderate `score` and low `chunkIndex`
3. Empty input → returns `Result<[]>` (empty array, not error)
4. Single chunk → returns it unchanged

### Verification commands:
```bash
pnpm typecheck
# Expected: exits 0

pnpm test
# Expected: retriever + reranker tests pass alongside Day 03 tests
```

---

## [MY TASKS]

- [ ] **Review `retriever.ts`** — confirm it imports from `@nimbus/db` and has zero Drizzle/SQL imports
- [ ] **Review `reranker.ts`** — trace through the heuristic formula manually with one example chunk set
- [ ] **Ask yourself:** Why does the reranker accept a `query` parameter it doesn't use? (Answer: interface compliance for future CrossEncoderReranker swap)
- [ ] **Run tests** with `pnpm test`

---

## Definition of Done

- [ ] `packages/rag-core/src/retriever.ts` exists, implements `Retriever` interface
- [ ] `packages/rag-core/src/reranker.ts` exists, implements `Reranker` interface
- [ ] `PgVectorRetriever` has ZERO Drizzle/SQL imports — uses only `@nimbus/db` repository functions
- [ ] `HeuristicReranker` applies the weighted formula and returns chunks in descending `finalScore` order
- [ ] All 4 retriever unit tests pass
- [ ] All 4 reranker unit tests pass
- [ ] `console.time` guard present in `retriever.ts` with 20ms budget annotation
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0 (all Day 01–04 tests passing)
