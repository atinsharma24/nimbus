# Project Nimbus

> A production-grade **RAG (Retrieval-Augmented Generation) workspace** built on Next.js 14, PostgreSQL + pgvector, and the Groq API. Users upload documents, build semantic search indexes, and query them through a streaming conversational interface.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
  - [Document Ingestion Pipeline](#document-ingestion-pipeline)
  - [Query Pipeline](#query-pipeline)
  - [Latency Budget](#latency-budget)
- [Design Patterns](#design-patterns)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

---

## Overview

Standard LLMs have a fixed knowledge cutoff and cannot access private documents. Nimbus bridges this gap using RAG: at query time, the system retrieves the most semantically relevant text chunks from a pgvector index and injects them into the LLM prompt as grounded context — eliminating hallucination on private knowledge.

**What it does:**

- Parse uploaded PDFs, Markdown files, and plain text
- Split documents into 512-token chunks with 64-token overlap
- Embed each chunk using OpenAI `text-embedding-3-small` (1536-dim vectors)
- Store embeddings in PostgreSQL with a pgvector HNSW index for sub-20ms approximate nearest-neighbor search
- Stream answers from Groq's `llama-3.3-70b-versatile` grounded in the retrieved context

**What makes it production-grade:**

- 800ms end-to-end SLA with per-stage latency budgets
- `Result<T>` monad — no silent failures anywhere in the pipeline
- Strategy Pattern — swap embedding providers, chunkers, or LLMs without touching orchestration code
- Zod-validated environment with fail-fast startup checks
- Singleton DB client with Next.js HMR safety guard

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| **Frontend** | Next.js App Router | 14 |
| **Language** | TypeScript (strict mode) | 5.4 |
| **Database** | PostgreSQL + pgvector extension | 16 + 0.8.2 |
| **ORM** | Drizzle ORM | 0.31.4 |
| **LLM** | Groq API — `llama-3.3-70b-versatile` | — |
| **Embeddings** | OpenAI `text-embedding-3-small` | 1536-dim |
| **Styling** | Tailwind CSS | 3 |
| **Testing** | Vitest | 1.6 |
| **Package Manager** | pnpm (workspaces) | 10 |
| **Infrastructure** | Docker / OrbStack | — |

---

## Architecture

### Document Ingestion Pipeline

```
User Upload
    │
    ▼
FileParser          ← Routes by MIME type (PDF → PDFParser, MD → MarkdownParser, txt → Identity)
    │
    ▼
Chunker             ← Splits text into 512-token segments with 64-token overlap
    │                  PATTERN: Strategy — FixedSizeChunker | SentenceChunker
    ▼
Embedder            ← Converts each chunk to a 1536-dim float vector
    │                  PATTERN: Strategy — OpenAIEmbedder | LocalEmbedder
    ▼
pgvector INSERT     ← Stores chunk text + embedding vector in the chunks table
                       HNSW index created at migration time (cosine distance)
```

### Query Pipeline

```
User Query
    │
    ▼
QueryEmbedder       ← Embeds the query string using the same model as ingestion
    │
    ▼
pgvector ANN Search ← HNSW index, retrieves top-10 candidates (~20ms)
    │                  O(log n) approximate nearest-neighbor — not exact
    ▼
Reranker            ← Re-scores top-10 → returns top-5 (~30ms)
    │                  PATTERN: Strategy — HeuristicReranker | CrossEncoderReranker
    ▼
ContextBuilder      ← Assembles system prompt with retrieved chunk text
    │
    ▼
Groq LLM            ← llama-3.3-70b-versatile, streamed via chat completions API
    │                  ~600ms to first token
    ▼
SSE Stream → UI     ← ReadableStream piped through Next.js Route Handler to browser
```

### Latency Budget

The system targets an **800ms end-to-end SLA** from query submission to first streamed token.

| Stage | Budget | Notes |
|---|---|---|
| Query Embedding | 50ms | OpenAI API round trip |
| pgvector ANN Search | 20ms | HNSW index, cosine distance |
| Reranking | 30ms | Heuristic: similarity score × inverse chunk position |
| LLM First Token | 600ms | Groq `llama-3.3-70b-versatile`, streaming |
| Overhead (routing) | 100ms | Next.js Route Handler + serialization |
| **Total** | **800ms** | |

---

## Design Patterns

Nimbus is structured as a showcase of production design patterns applied to a real system.

### Strategy Pattern

Every pipeline stage is defined as a TypeScript `interface` in `packages/rag-core/src/interfaces.ts`. Concrete implementations are injected at runtime, making providers fully swappable:

```typescript
// Swap OpenAI for a local model — orchestration code is unchanged
const embedder: Embedder = new OpenAIEmbedder(openaiClient);
// const embedder: Embedder = new LocalEmbedder();
```

Interfaces defined: `Chunker`, `Embedder`, `Retriever`, `Reranker`, `Generator`.

### Result Monad

Every I/O-touching function returns `Result<T>` — no raw `throw` in business logic. Callers are forced to handle both branches explicitly, surfacing errors early and making the control flow obvious:

```typescript
type Result<T, E extends AppError = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// Caller is forced to check ok before using value
const result = await embedder.embed(chunkText);
if (!result.ok) return result; // propagate error up
const vector = result.value;
```

### Repository Pattern

All database access lives in `packages/db/src/repository.ts`. No SQL or Drizzle queries appear in business logic or API routes — they call typed repository functions only. This makes the data layer independently testable and replaceable.

### Singleton DB Client

The Drizzle connection pool is stored on `globalThis` with a hot-reload guard. Without this, Next.js HMR would open a new pool on every file save, eventually exhausting the Postgres `max_connections` limit:

```typescript
const globalWithDrizzle = globalThis as typeof globalThis & { db?: DrizzleClient };
export const db = globalWithDrizzle.db ?? createClient();
if (process.env.NODE_ENV !== 'production') globalWithDrizzle.db = db;
```

### Hexagonal Architecture

Business logic in `packages/rag-core` has zero imports from `packages/db`. The RAG pipeline operates purely on domain types (`Chunk`, `RetrievedChunk`, `Query`) defined in `packages/config`. Database access is injected via the repository at the orchestration layer — making every pipeline stage unit-testable without a real database.

### Fail Fast (Zod env validation)

All required environment variables are validated through a Zod schema at startup. If any variable is missing or malformed, the application exits immediately with a clear error message — never silently falling back to an undefined value at runtime:

```typescript
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  OPENAI_API_KEY: z.string().min(1),
  GROQ_API_KEY: z.string().min(1),
});
```

---

## Project Structure

```
nimbus/
├── apps/
│   └── web/                        Next.js 14 App Router
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx            Upload dashboard + Chat UI
│       │   └── api/
│       │       ├── documents/
│       │       │   └── route.ts    POST /api/documents — file ingestion
│       │       └── chat/
│       │           └── route.ts    POST /api/chat — SSE streaming response
│       └── components/
│           ├── upload-zone.tsx
│           ├── chat-window.tsx
│           └── document-list.tsx
├── packages/
│   ├── config/                     Shared types + constants + env validation
│   │   └── src/
│   │       ├── types.ts            Result<T>, Document, Chunk, Query, RetrievedChunk
│   │       ├── constants.ts        EMBEDDING_DIM, LATENCY_BUDGET, model names
│   │       └── env.ts              Zod-validated env schema
│   ├── db/                         Drizzle ORM schema + pgvector client
│   │   └── src/
│   │       ├── schema.ts           documents + chunks tables; vector(1536) column
│   │       ├── client.ts           Singleton Drizzle client (HMR-safe)
│   │       └── repository.ts       All DB access functions — typed, no raw SQL in app code
│   └── rag-core/                   Pipeline stage implementations
│       └── src/
│           ├── interfaces.ts       Chunker, Embedder, Retriever, Reranker, Generator
│           ├── chunker.ts          FixedSizeChunker (gpt-tokenizer, 512 tokens, 64 overlap)
│           ├── embedder.ts         OpenAIEmbedder (text-embedding-3-small, 1536-dim)
│           ├── retriever.ts        PgVectorRetriever (HNSW + cosine distance)
│           ├── reranker.ts         HeuristicReranker (score × inverse position)
│           ├── generator.ts        GroqGenerator (llama-3.3-70b-versatile, SSE)
│           └── pipeline.ts         Ingestion + Query orchestrators
├── infra/
│   ├── docker-compose.yml          Postgres 16 + pgvector + Adminer
│   └── init.sql                    CREATE EXTENSION vector
├── docs/
│   ├── architecture.md             Pipeline diagrams + DB schema reference
│   └── roadmap/                    Day-by-day implementation specs (Day 00–08)
├── .env.local                      Local secrets — NOT committed
├── .env.example                    Template with placeholder values
└── package.json                    pnpm workspace root
```

---

## Database Schema

### `documents`

Stores metadata about user-uploaded source files. One document → many chunks.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Auto-generated via `gen_random_uuid()` |
| `filename` | `text NOT NULL` | Original upload filename |
| `mime_type` | `text NOT NULL` | Routes to the correct FileParser |
| `status` | `enum` | `pending → processing → indexed / failed` |
| `error_message` | `text` | Set on failure for debugging |
| `created_at` | `timestamp` | |
| `updated_at` | `timestamp` | |

### `chunks`

Stores text segments and their embedding vectors for similarity search.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Auto-generated |
| `document_id` | `uuid FK` | References `documents.id`, cascade delete |
| `content` | `text NOT NULL` | The chunk text (512 tokens max) |
| `chunk_index` | `integer NOT NULL` | Position within the parent document |
| `embedding` | `vector(1536)` | L2-normalized float array for cosine similarity |
| `created_at` | `timestamp` | |

**Index:** `HNSW` on `embedding` using `vector_cosine_ops` — enables `<=>` cosine distance queries at O(log n).

---

## Prerequisites

| Tool | Minimum Version | Install |
|---|---|---|
| Node.js | 20 LTS | [nodejs.org](https://nodejs.org) |
| pnpm | 10 | `npm install -g pnpm` |
| Docker / OrbStack | Any recent | [orbstack.dev](https://orbstack.dev) or [docker.com](https://docker.com) |
| PostgreSQL client (`psql`) | 16 | Bundled with Postgres install |

You will also need:
- **OpenAI API key** — for `text-embedding-3-small` embeddings
- **Groq API key** — for `llama-3.3-70b-versatile` LLM generation (free tier available at [console.groq.com](https://console.groq.com))

---

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/atinsharma24/nimbus.git
cd nimbus
pnpm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in your credentials:

```bash
DATABASE_URL=postgresql://nimbus:nimbus@localhost:5432/nimbus_db
OPENAI_API_KEY=sk-proj-...          # from platform.openai.com
GROQ_API_KEY=gsk_...                # from console.groq.com
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Start the database

```bash
cd infra && docker-compose up -d
```

This starts:
- **PostgreSQL 16 + pgvector** on `localhost:5432`
- **Adminer** (database browser) on `http://localhost:8080`

### 4. Push the schema

```bash
pnpm db:push
```

Drizzle will introspect the database and apply any pending schema changes. On first run this creates the `documents` and `chunks` tables and the HNSW index.

### 5. Run the dev server

```bash
pnpm dev
```

The app is available at `http://localhost:3000`.

### 6. Verify the setup (optional)

```bash
pnpm test
```

Runs the smoke test suite — verifies that `EMBEDDING_DIM = 1536` and (if `OPENAI_API_KEY` is set) confirms a live embedding call returns the correct vector dimension.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `OPENAI_API_KEY` | Yes | OpenAI API key for embeddings |
| `GROQ_API_KEY` | Yes | Groq API key for LLM generation |
| `NODE_ENV` | No | `development` or `production` |
| `NEXT_PUBLIC_APP_URL` | No | Full public URL (used for CORS, canonical links) |
| `SKIP_ENV_VALIDATION` | No | Set to `1` to bypass Zod validation (CI/build environments only) |

All variables are validated at startup via Zod. The application will exit immediately with a clear error if any required variable is missing.

---

## Available Scripts

Run from the monorepo root unless noted.

| Command | Description |
|---|---|
| `pnpm dev` | Start the Next.js development server |
| `pnpm build` | Build all packages and the Next.js app for production |
| `pnpm typecheck` | Run `tsc --noEmit` across all packages |
| `pnpm test` | Run the Vitest test suite in `packages/rag-core` |
| `pnpm db:push` | Push Drizzle schema to the connected database |
| `pnpm db:generate` | Generate Drizzle migration files |
| `pnpm db:studio` | Open Drizzle Studio database browser at `https://local.drizzle.studio` |

---

## Roadmap

The project is structured as an 8-day implementation plan, each day building one vertical slice of the system.

| Day | Phase | Deliverable |
|---|---|---|
| Day 00 | Foundations | pnpm monorepo, Docker Postgres, pgvector schema, environment validation, smoke tests passing |
| Day 01 | Env Bootstrap | Audit fixes, Zod env validation wired up, `db:push` verified, dev server live |
| Day 02 | Data Layer | `packages/db/src/repository.ts` — all typed DB access functions (insert document, insert chunks, find similar, update status) |
| Day 03 | Chunker + Embedder | `FixedSizeChunker` (gpt-tokenizer) + `OpenAIEmbedder` (text-embedding-3-small) with unit tests |
| Day 04 | Retriever + Reranker | `PgVectorRetriever` (HNSW + cosine) + `HeuristicReranker` with latency assertions |
| Day 05 | Generator | `GroqGenerator` with `ReadableStream` SSE output + integration test |
| Day 06 | Orchestration | `ingestDocument()` and `queryDocuments()` orchestrators wiring all stages together |
| Day 07 | API Routes | `POST /api/documents` (multipart upload) + `POST /api/chat` (SSE stream) |
| Day 08 | Frontend | Upload dashboard + Chat UI + E2E latency verification under 800ms |

Full day-by-day specs are in [`docs/roadmap/`](docs/roadmap/).

---

## Contributing

This is a portfolio project under active development. The codebase follows strict conventions:

1. **Every I/O function returns `Result<T>`** — never `throw` in business logic.
2. **No `any` types** — use `unknown` and narrow explicitly.
3. **No raw SQL in application code** — all DB access goes through `repository.ts`.
4. **Each pipeline stage is independently testable** — `rag-core` has no DB imports.
5. **Latency-aware** — add `console.time` / `console.timeEnd` pairs in dev mode for any new pipeline stage.

---

*Project Nimbus — RAG workspace portfolio project | May 2026 | Atin Sharma*
