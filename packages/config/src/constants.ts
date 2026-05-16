/**
 * @module constants
 * @description System-wide constants for the Nimbus RAG pipeline.
 * All magic numbers live here — never inline them in business logic.
 *
 * Naming convention: SCREAMING_SNAKE_CASE for all constants (per rules.md §7)
 */

// =============================================================
// Chunking constants
// [INTERVIEW ANCHOR] Chunk size is a core RAG hyperparameter.
// Too large → noisy retrieved context; too small → incomplete context.
// 512 tokens ≈ 400 words is the sweet spot for most embedding models.
// =============================================================

/** Maximum number of tokens per chunk (approximate — tokenization is model-dependent) */
export const MAX_CHUNK_SIZE = 512;

/** Overlap between adjacent chunks in tokens — preserves cross-boundary context */
export const CHUNK_OVERLAP = 64;

// =============================================================
// Retrieval constants
// =============================================================

/** Default number of chunks to retrieve before reranking */
export const DEFAULT_TOP_K = 10;

/** Number of chunks passed to the LLM after reranking */
export const RERANKED_TOP_K = 5;

// =============================================================
// Embedding constants
// =============================================================

/**
 * Dimension of embedding vectors.
 * Must match the pgvector column definition: vector(1536).
 * [INTERVIEW ANCHOR] Changing this requires a full re-embedding of all documents —
 * this is why the dimension is a named constant, not a magic number.
 */
export const EMBEDDING_DIM = 1536;

// Groq model identifiers — named so we update once, not across every file
export const GROQ_CHAT_MODEL = 'llama-3.3-70b-versatile' as const;
export const GROQ_EMBEDDING_MODEL = 'text-embedding-ada-002' as const;

// =============================================================
// Latency budget (milliseconds) — from architecture.md §6
// These are targets, not guarantees. Flag violations in console.time logs.
// =============================================================
export const LATENCY_BUDGET = {
  EMBEDDING:   50,   // ms — Groq embedding endpoint
  RETRIEVAL:   20,   // ms — pgvector HNSW ANN search
  RERANKING:   30,   // ms — cross-encoder or heuristic
  LLM_FIRST_TOKEN: 600, // ms — Groq streamed first token
  OVERHEAD:    100,  // ms — routing, serialization
  TOTAL:       800,  // ms — end-to-end SLA
} as const;
