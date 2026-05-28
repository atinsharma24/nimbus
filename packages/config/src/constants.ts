/**
 * @module constants
 * @description Shared constants for Project Nimbus.
 * Single source of truth for all magic numbers and model identifiers.
 *
 * [INTERVIEW ANCHOR] Centralising model names and dimensions here means
 * swapping the embedding model is a one-line change — the interface
 * contracts in rag-core do the rest.
 */

// =============================================================
// Embedding
// =============================================================

/**
 * OpenAI text-embedding-3-small → 1536 dimensions.
 * If switching to Ollama/nomic-embed-text, change to 768
 * AND update the vector(1536) column in schema.ts.
 */
export const EMBEDDING_DIM = 1536;
export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

// =============================================================
// Chunking
// =============================================================
export const MAX_CHUNK_SIZE = 512;   // tokens
export const CHUNK_OVERLAP = 64;     // tokens

// =============================================================
// LLM
// =============================================================
export const GROQ_CHAT_MODEL = 'llama-3.3-70b-versatile';

// =============================================================
// Retrieval
// =============================================================
export const DEFAULT_TOP_K = 10;     // ANN retrieval candidates
export const RERANKED_TOP_K = 5;     // After reranking, pass this many to LLM

// =============================================================
// Latency Budget (milliseconds) — 800ms E2E SLA
// [INTERVIEW ANCHOR] Hard SLA numbers signal production thinking.
// =============================================================
export const LATENCY_BUDGET = {
  QUERY_EMBEDDING:  50,
  VECTOR_SEARCH:    20,
  RERANKING:        30,
  LLM_FIRST_TOKEN: 600,
  OVERHEAD:        100,
  TOTAL:           800,
} as const;
