# Day 06 — Pipeline Orchestrators

## Context

Days 03–05 built every RAG-core component as an isolated, tested unit. Day 06 wires them together into two orchestrating functions: one for document ingestion and one for query answering. These orchestrators are the "pipes" connecting the stages — they hold no business logic themselves, only coordination.

After today, the entire RAG pipeline can be exercised end-to-end in a Node.js script before any UI or HTTP layer is involved.

---

## [AGENT TASKS]

### File to Create: `packages/rag-core/src/pipeline.ts`

**Concept:** An orchestrator coordinates a sequence of steps. It does not contain logic — it delegates to components. If any step returns `Result.error`, the orchestrator short-circuits and propagates the failure. This is the "Railway-Oriented Programming" application of the Result monad: the happy path is a straight track, and errors switch the train to the failure track without crashing.

> **[INTERVIEW ANCHOR]** Railway-Oriented Programming (Scott Wlaschin) is a functional pattern for chaining operations that can fail. Each step is a function `a → Result<b>`. If any step fails, all subsequent steps are skipped. This is equivalent to Haskell's `Maybe` monad or Rust's `?` operator.

---

### Function 1: `ingestDocument`

**Responsibility:** Full ingestion pipeline — parse raw file bytes into text, chunk it, embed all chunks, write them to the DB.

**Signature:**
```typescript
export async function ingestDocument(
  documentId: string,
  content: Buffer | string,
  mimeType: string,
  options?: {
    chunker?: Chunker;
    embedder?: Embedder;
  }
): Promise<Result<{ chunksCreated: number }>>
```

**Pipeline steps (implement in this order):**
```
1. updateDocumentStatus(documentId, 'processing')
2. parseDocument(content, mimeType) → raw text   [Result — bail on error]
3. chunker.chunk(text, documentId) → Chunk[]      [Result — bail on error]
4. embedder.embedBatch(chunks.map(c => c.content)) → number[][] [Result — bail on error]
5. Attach embeddings to chunks: chunks[i].embedding = embeddings[i]
6. insertChunks(chunks with embeddings) → ChunkRow[] [Result — bail on error]
7. updateDocumentStatus(documentId, 'indexed')
8. Return { ok: true, value: { chunksCreated: chunks.length } }

On any error:
  updateDocumentStatus(documentId, 'failed', error.message)
  return { ok: false, error }
```

**Default instances (injected if not provided):**
```typescript
const defaultChunker = new FixedSizeChunker();
const defaultEmbedder = new OllamaEmbedder();
```

This makes the function testable by injecting mock implementations.

---

### Function 2: `queryPipeline`

**Responsibility:** Full query pipeline — embed the user's query, retrieve similar chunks, rerank, generate streamed LLM response.

**Signature:**
```typescript
export async function queryPipeline(
  query: string,
  options?: {
    embedder?: Embedder;
    retriever?: Retriever;
    reranker?: Reranker;
    generator?: Generator;
    topK?: number;
  }
): Promise<Result<ReadableStream>>
```

**Pipeline steps:**
```
1. embedder.embed(query) → number[]              [Result — bail on error]
2. retriever.retrieve(embedding, { topK })       [Result — bail on error]
3. reranker.rerank(query, retrievedChunks)       [Result — bail on error]
4. generator.generate(query, rerankedChunks)     [Result — bail on error]
5. Return { ok: true, value: stream }
```

**Latency instrumentation — wrap the ENTIRE pipeline:**
```typescript
const e2eStart = Date.now();
// ... pipeline ...
const e2eMs = Date.now() - e2eStart;
if (e2eMs > LATENCY_BUDGET.TOTAL) {
  console.warn(`[pipeline] ⚠️ E2E latency ${e2eMs}ms exceeds 800ms budget`);
}
```

---

### Smoke-test script (for manual verification, NOT committed)

Create a temporary file `scripts/smoke-test.ts`:
```typescript
// Run with: npx tsx scripts/smoke-test.ts
import { ingestDocument } from './packages/rag-core/src/pipeline';
import { createDocument } from './packages/db/src';

async function main() {
  const doc = await createDocument({ filename: 'test.md', mimeType: 'text/markdown', status: 'pending' });
  if (!doc.ok) throw new Error(doc.error.message);

  const result = await ingestDocument(
    doc.value.id,
    '# Hello\nThis is a test document for Project Nimbus.',
    'text/markdown'
  );
  console.log('Ingestion result:', result);
}
main().catch(console.error);
```

### Verification commands:
```bash
pnpm typecheck
# Expected: exits 0

pnpm test
# Expected: all tests still passing (orchestrator unit tests + all prior)

# Manual smoke test (requires DB + Ollama running)
npx tsx scripts/smoke-test.ts
# Expected: Ingestion result: { ok: true, value: { chunksCreated: 1 } }
```

---

## [MY TASKS]

- [ ] **Confirm DB + Ollama are running** before smoke test
- [ ] **Run the smoke test manually** and confirm `chunksCreated > 0`
- [ ] **Inspect the DB** via Adminer (http://localhost:8080) — confirm a row in `documents` and rows in `chunks`
- [ ] **Review `pipeline.ts`** — understand the short-circuit pattern: what happens if `embedder.embed()` fails? Trace it through.
- [ ] **Delete `scripts/smoke-test.ts`** after verification (it's a temporary script, not production code)

---

## Definition of Done

- [ ] `packages/rag-core/src/pipeline.ts` exists with `ingestDocument` and `queryPipeline`
- [ ] Both functions accept optional injected implementations (testable)
- [ ] `ingestDocument` correctly sets status to `'processing'`, then `'indexed'` on success or `'failed'` on error
- [ ] `queryPipeline` logs a warning when E2E latency > 800ms
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] Manual smoke test: a real markdown doc is ingested with chunks stored in DB (verified via Adminer)
