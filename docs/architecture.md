# Project Nimbus — Architecture Reference

> **Stack:** Next.js 14 · TypeScript 5 · PostgreSQL 16 + pgvector · Drizzle ORM · Groq API  
> **Scope:** SDE-1 portfolio project / 16-week Gradual Deep Mastery program (Track B)

---

## System Overview

Nimbus is a **RAG (Retrieval-Augmented Generation) workspace** — a developer-facing tool that lets users ingest documents, build semantic search indexes, and query them through a conversational LLM interface.

### Why RAG?
Standard LLMs have a fixed knowledge cutoff and can't access private documents. RAG bridges this gap by retrieving relevant text chunks at query time and injecting them into the LLM prompt as context. The LLM then generates answers grounded in the retrieved data rather than hallucinating.

---

## Pipeline Architecture

### Document Ingestion Path

```
User Upload
    │
    ▼
FileParser          ← Routes by MIME type (PDF → PDFParser, MD → MarkdownParser)
    │
    ▼
Chunker             ← Splits text into 512-token segments with 64-token overlap
    │                  PATTERN: Strategy — FixedSizeChunker | SentenceChunker
    ▼
Embedder            ← Converts each chunk to a 1536-dim float vector
    │                  PATTERN: Strategy — GroqEmbedder | LocalEmbedder
    ▼
pgvector INSERT     ← Stores chunk + embedding in chunks table
```

### Query Path

```
User Query
    │
    ▼
QueryEmbedder       ← Embeds the query string (same model as document embedder)
    │
    ▼
pgvector ANN Search ← HNSW index, top-k=10 candidates (~20ms)
    │                  [INTERVIEW ANCHOR] HNSW = Hierarchical Navigable Small World graph
    │                  O(log n) approximate nearest-neighbor, not exact
    ▼
Reranker            ← Re-scores top-10 → returns top-5 (~30ms)
    │                  PATTERN: Strategy — HeuristicReranker | CrossEncoderReranker
    ▼
ContextBuilder      ← Assembles prompt with retrieved chunk text
    │
    ▼
Groq LLM            ← llama-3.3-70b-versatile, streamed (~600ms to first token)
    │
    ▼
SSE Stream → UI     ← ReadableStream piped to Next.js Route Handler
```

---

## Latency Budget (800ms E2E SLA)

| Stage | Budget | Implementation |
|---|---|---|
| Query Embedding | 50ms | Groq embedding endpoint |
| pgvector ANN Search | 20ms | HNSW index, top-k=5 |
| Reranking | 30ms | Cross-encoder or heuristic |
| LLM First Token | 600ms | Groq `llama-3.3-70b-versatile`, streamed |
| Overhead (routing) | 100ms | Next.js Route Handler + serialization |
| **Total** | **800ms** | |

> **Agent directive:** Flag any implementation that exceeds a stage's budget and propose the faster alternative.

---

## Design Patterns Index

| Pattern | Where Used | Interview Relevance |
|---|---|---|
| **Strategy** | Chunker, Embedder, Retriever, Reranker, Generator interfaces | Swap providers without changing callers |
| **Result Monad** | Every async function returning `Result<T>` | Explicit error handling, no silent failures |
| **Repository** | `packages/db` — all DB access through typed functions | Separation of concerns; testable in isolation |
| **Singleton** | Drizzle client connection pool | Prevents connection exhaustion |
| **Hexagonal Architecture** | Business logic in `rag-core` (no DB imports) | Core logic testable without infrastructure |
| **Fail Fast** | Zod env validation at startup | Surface config errors at boot, not runtime |

---

## Repository Structure

```
nimbus/
├── .antigravity/
│   └── rules.md              ← Agent operating rules
├── apps/
│   └── web/                  ← Next.js 14 App Router frontend
│       ├── app/              ← Route handlers + page components
│       └── components/       ← UI components (Client Components only where needed)
├── packages/
│   ├── config/               ← Shared types (Result<T>, Chunk, Document)
│   │   └── src/
│   │       ├── types.ts      ← Domain types + Result monad
│   │       ├── constants.ts  ← LATENCY_BUDGET, MAX_CHUNK_SIZE, GROQ_CHAT_MODEL
│   │       └── env.ts        ← Zod-validated env schema
│   ├── db/                   ← Drizzle ORM schema + pgvector client
│   │   └── src/
│   │       ├── schema.ts     ← documents + chunks tables
│   │       └── client.ts     ← Singleton Drizzle client
│   └── rag-core/             ← Pipeline interfaces (Strategy Pattern)
│       └── src/
│           └── interfaces.ts ← Chunker, Embedder, Retriever, Reranker, Generator
├── infra/
│   ├── docker-compose.yml    ← Postgres 16 + pgvector + Adminer
│   └── init.sql              ← CREATE EXTENSION vector
└── docs/
    └── architecture.md       ← YOU ARE HERE
```

---

## Database Schema

### `documents` table
Stores metadata about user-uploaded source files. One document → many chunks.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Auto-generated |
| `filename` | `text` | Original upload filename |
| `mime_type` | `text` | Routes to correct FileParser |
| `status` | `enum` | `pending → processing → indexed / failed` |
| `error_message` | `text?` | Set on failure for debugging |
| `created_at` | `timestamp` | |
| `updated_at` | `timestamp` | |

### `chunks` table
Stores text segments + their embedding vectors for similarity search.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Auto-generated |
| `document_id` | `uuid` FK | Cascade delete |
| `content` | `text` | The actual chunk text |
| `chunk_index` | `integer` | Position in parent document |
| `embedding` | `vector(1536)` | L2-normalized float array for cosine similarity |
| `created_at` | `timestamp` | |

---

## Local Development Setup

```bash
# 1. Start database
cd infra && docker-compose up -d

# 2. Configure environment
cp .env.example .env.local
# Fill in GROQ_API_KEY and DATABASE_URL in .env.local

# 3. Push Drizzle schema to DB
pnpm db:push

# 4. Start Next.js dev server
pnpm dev
# → http://localhost:3000

# 5. Optional: Drizzle Studio (DB browser)
pnpm db:studio
# → https://local.drizzle.studio
```

---

*Architecture document — Project Nimbus v1.0*  
*Updated: May 2026 | Owner: Atin*
