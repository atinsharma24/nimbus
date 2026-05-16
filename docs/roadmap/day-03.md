# Day 03 — Chunker + Embedder

## Context

Day 02 delivered a fully tested Repository layer. We can now write to and read from the database with typed, error-safe functions. Day 03 implements the first two stages of the document ingestion pipeline: splitting raw text into chunks, and converting those chunks into embedding vectors.

These two stages are the most pedagogically dense: they touch tokenization, vector spaces, and the Strategy Pattern for real. This day deliberately scopes to just these two stages — the pipeline cannot run end-to-end yet, but each stage can be unit-tested in isolation.

---

## [AGENT TASKS]

### Stage 1: `packages/rag-core/src/chunker.ts` — FixedSizeChunker

**Concept:** Chunking splits a long document into overlapping segments small enough for an embedding model's context window. "Fixed size" means we target a maximum number of tokens per chunk. "Overlap" means each chunk shares 64 tokens with the previous one — this preserves context at chunk boundaries (a sentence split mid-thought is readable in either adjacent chunk).

**Pattern:** Implements the `Chunker` interface from `interfaces.ts`. This is the Strategy Pattern: the ingestion pipeline accepts any `Chunker`, making `SentenceChunker` a drop-in upgrade.

**Dependency to add:**  
```bash
pnpm --filter @nimbus/rag-core add gpt-tokenizer
```
- **What it solves:** BPE tokenization compatible with most open-weight models.
- **Why not tiktoken?** `tiktoken` is a native Rust binding — harder to install cross-platform. `gpt-tokenizer` is pure JS with the same algorithm.
- **Bundle size:** ~200KB. Acceptable for a server-side package.

**Key algorithm (implement this exactly):**
```
1. Tokenize full text → token array
2. Slide a window of MAX_CHUNK_SIZE tokens, stepping by (MAX_CHUNK_SIZE - CHUNK_OVERLAP)
3. Decode each window back to a string
4. Build a Chunk object for each window with chunkIndex = window number
5. Return Result<Chunk[]>
```

**Function signature:**
```typescript
export class FixedSizeChunker implements Chunker {
  chunk(text: string, documentId: string, options?: Partial<ChunkOptions>): Result<Chunk[]>
}
```

**Test file: `packages/rag-core/__tests__/chunker.test.ts`**

Test cases:
1. Short text (< MAX_CHUNK_SIZE) → produces exactly 1 chunk
2. Text exactly at MAX_CHUNK_SIZE → produces exactly 1 chunk
3. Long text (3× MAX_CHUNK_SIZE) → produces multiple chunks with correct overlap
4. Empty string → returns `Result.error` with code `'CHUNKER_EMPTY_INPUT'`
5. Each chunk's `documentId` matches the argument

---

### Stage 2: `packages/rag-core/src/embedder.ts` — OllamaEmbedder

**Concept:** Embedding converts text into a high-dimensional float vector where semantically similar texts have geometrically close vectors. This is what makes "What is the capital of France?" and "Tell me about Paris" retrievable by the same query — they map to nearby points in vector space.

**Pattern:** Implements the `Embedder` interface from `interfaces.ts`. Strategy Pattern: an `OpenAIEmbedder` would have the identical signature.

**Dependency to add:**  
```bash
pnpm --filter @nimbus/rag-core add ollama
```
- **What it solves:** Official Ollama JS SDK — handles HTTP to the local Ollama daemon.
- **Why not a raw fetch?** The SDK handles retries, streaming, and type safety.

**Function signatures:**
```typescript
export class OllamaEmbedder implements Embedder {
  constructor(private readonly model: string = OLLAMA_EMBEDDING_MODEL) {}
  async embed(text: string): Promise<Result<number[]>>
  async embedBatch(texts: string[]): Promise<Result<number[][]>>
}
```

**Key implementation note:** After receiving the embedding from Ollama, **L2-normalize** the vector before returning it:
```typescript
function l2Normalize(vec: number[]): number[] {
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return magnitude === 0 ? vec : vec.map(v => v / magnitude);
}
```

> **[INTERVIEW ANCHOR]** L2 normalization ensures all vectors lie on the unit hypersphere. On the unit sphere, cosine similarity = dot product. This lets pgvector compute cosine distance with a single dot product — much faster than the full formula.

**Test file: `packages/rag-core/__tests__/embedder.test.ts`**

Use `vi.mock('ollama', ...)` to stub the response. Test cases:
1. `embed('hello world')` with mocked Ollama → returns `Result<number[]>` with `ok: true`
2. The returned vector is L2-normalized (magnitude ≈ 1.0, tolerance 1e-6)
3. Ollama returns an error → `embed()` returns `Result.error` with `ok: false`
4. `embedBatch(['a', 'b', 'c'])` → returns `Result<number[][]>` with length 3

### Verification commands:
```bash
# Confirm Ollama model is available
ollama list
# Expected: nomic-embed-text listed

# TypeScript check
pnpm typecheck

# Unit tests
pnpm test
# Expected: all chunker + embedder tests passing
```

---

## [MY TASKS]

- [ ] **Start Ollama daemon:** `ollama serve`
- [ ] **Verify model is pulled:** `ollama list` shows `nomic-embed-text`
- [ ] **Manually test embedding** before the agent builds against it:  
  ```bash
  curl http://localhost:11434/api/embeddings \
    -d '{"model": "nomic-embed-text", "prompt": "hello world"}'
  ```
  Expected: JSON with `"embedding": [...]` (768 numbers)
- [ ] **Review `chunker.ts` diff** — understand the sliding window algorithm
- [ ] **Review `embedder.ts` diff** — understand why L2 normalization is applied
- [ ] **Run tests yourself** with `pnpm test`

---

## Definition of Done

- [ ] `packages/rag-core/src/chunker.ts` exists, implements `Chunker` interface
- [ ] `packages/rag-core/src/embedder.ts` exists, implements `Embedder` interface
- [ ] `gpt-tokenizer` and `ollama` are in `packages/rag-core/package.json`
- [ ] All 5 chunker unit tests pass
- [ ] All 4 embedder unit tests pass (with mocked Ollama)
- [ ] Embedding vectors are L2-normalized before return
- [ ] `console.time` guards present in both files
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
