# Project Nimbus — Roadmap Overview

> **Stack:** Next.js 14 · TypeScript 5 · PostgreSQL 16 + pgvector · Drizzle ORM · Groq API  
> **Timeline:** 8 focused days × 4–6 hours/day  
> **Goal:** A fully functional RAG workspace, production-grade from day one.

---

## Phase Map

| Phase | Days | Focus |
|---|---|---|
| **0 — Foundations** | Day 01 | Audit fixes, env setup, DB migrations verified |
| **1 — Data Layer** | Day 02 | `packages/db/src/repository.ts` — all DB access functions |
| **2 — RAG Core** | Day 03–05 | Chunker → Embedder → Retriever → Reranker → Generator (one stage/day) |
| **3 — Orchestration** | Day 06 | Ingestion pipeline + Query pipeline orchestrators |
| **4 — API Routes** | Day 07 | `POST /api/documents`, `POST /api/chat` (SSE stream) |
| **5 — Frontend** | Day 08 | Upload dashboard + Chat UI + E2E latency verification |

---

## Opinionated Tech Decisions

These decisions are baked in based on the architecture doc, rules.md, and current state. No further discussion needed unless you override them.

### Embedder: `nomic-embed-text` via Ollama (local), OpenAI `text-embedding-3-small` (cloud)

> **[DECISION REQUIRED — Choose One Before Day 03]**
>
> The original constants file specified `text-embedding-ada-002`, which is an **OpenAI model, not a Groq model**. Groq has confirmed they do not offer an embedding endpoint as of 2025.
>
> Two viable paths:
>
> **Option A — Local-first (recommended for portfolio / zero cost):**  
> Use `nomic-embed-text` via Ollama running locally. Pull with `ollama pull nomic-embed-text`. Produces 768-dim vectors. **Requires changing `EMBEDDING_DIM = 768` and the `vector(768)` column definition.** Cost: free. Latency: ~30ms on M-series Mac.
>
> **Option B — Cloud (simplest integration, costs money):**  
> Use OpenAI `text-embedding-3-small` via the OpenAI SDK. Produces 1536-dim vectors. `EMBEDDING_DIM` stays at 1536. Cost: ~$0.02/1M tokens. Latency: ~50ms.
>
> **The agent will implement Option A (Ollama / nomic-embed-text) and will `EMBEDDING_DIM = 768` as the default.** If you choose Option B, tell the agent to switch before Day 03 begins — it requires a schema migration.

### Retriever: PgVectorRetriever with HNSW index + cosine distance `<=>`

Standard. HNSW gives O(log n) ANN search — the correct choice at this scale. IVFFlat is an alternative but requires training data upfront, making it worse for a dynamic doc store.

### Reranker: HeuristicReranker first, CrossEncoder later

`HeuristicReranker` uses a weighted combination of (a) pgvector similarity score and (b) inverse chunk position (earlier chunks in a doc score higher). Zero ML inference cost — keeps reranking within the 30ms budget comfortably. CrossEncoder (via Hugging Face) is documented as an upgrade path in Day 05 comments.

### Generator: GroqGenerator with SSE via ReadableStream

`llama-3.3-70b-versatile` streamed via Groq's chat completion API. The streamed `ReadableStream` is piped directly to a Next.js Route Handler `Response` — no intermediate buffering.

### File Parsers

- **PDFParser:** `pdf-parse` npm package. Justification: zero-dependency, works in Node.js, well-maintained. Alternative (pdf.js) is browser-first and adds complexity.
- **MarkdownParser:** Raw string processing — no library needed. Strip frontmatter, return body text.
- **PlainTextParser:** Identity transform — return `content` as-is.

### Chunker: FixedSizeChunker using `gpt-tokenizer`

`gpt-tokenizer` approximates token counts using the BPE algorithm compatible with most open-weight models. This is character-approximate but accurate enough for 512-token targets. `MAX_CHUNK_SIZE = 512`, `CHUNK_OVERLAP = 64`.

> **[DECISION REQUIRED — If you chose Ollama]** nomic-embed-text has a 2048-token context window, well above 512, so this is fine either way.

### Testing: Vitest

Already scaffolded. Unit tests for every pipeline stage (rules.md §4.6). No Playwright E2E in scope for this roadmap — added as a post-Day-08 stretch goal.

### Styling: Tailwind CSS 3

Per rules.md §2. Already installed in `apps/web`.

---

## Files To Be Created (Master List)

```
packages/
  config/src/
    constants.ts          ← MODIFY: fix GROQ_EMBEDDING_MODEL
  db/src/
    client.ts             ← MODIFY: add globalThis hot-reload guard
    repository.ts         ← CREATE: all DB access functions
  rag-core/src/
    chunker.ts            ← CREATE: FixedSizeChunker
    embedder.ts           ← CREATE: OllamaEmbedder (or OpenAIEmbedder)
    retriever.ts          ← CREATE: PgVectorRetriever
    reranker.ts           ← CREATE: HeuristicReranker
    generator.ts          ← CREATE: GroqGenerator
    pipeline.ts           ← CREATE: ingestion + query orchestrators
    index.ts              ← MODIFY: export all implementations
  rag-core/__tests__/
    chunker.test.ts       ← CREATE
    embedder.test.ts      ← CREATE
    retriever.test.ts     ← CREATE
    reranker.test.ts      ← CREATE
    generator.test.ts     ← CREATE
apps/
  web/app/
    api/
      documents/route.ts  ← CREATE: POST /api/documents
      chat/route.ts       ← CREATE: POST /api/chat (SSE)
    page.tsx              ← REWRITE: Upload dashboard + Chat UI
    components/
      upload-zone.tsx     ← CREATE
      chat-window.tsx     ← CREATE
      document-list.tsx   ← CREATE
```

---

## Key Constraints to Maintain Throughout

1. **Every I/O function returns `Result<T>`** — no raw throw in business logic.
2. **Every new module gets a JSDoc block** — `@module`, `@description`, pattern callout.
3. **Every non-trivial concept gets an `[INTERVIEW ANCHOR]` comment.**
4. **Latency `console.time` / `console.timeEnd` pairs** in dev mode for every pipeline stage.
5. **Diffs are atomic and reviewed before landing** (Artifact Review Policy = Asks for Review).

---

*Roadmap v1.0 — Project Nimbus | May 2026 | Owner: Atin*
