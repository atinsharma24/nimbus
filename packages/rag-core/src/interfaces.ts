/**
 * @module interfaces
 * @description Strategy interfaces for each RAG pipeline stage.
 *
 * PATTERN: Strategy — defines a family of algorithms (chunking strategies,
 * embedding providers, retrieval methods) behind a common interface.
 * Concrete implementations are swappable without changing the calling code.
 *
 * [INTERVIEW ANCHOR] This is the Strategy Pattern from the Gang of Four.
 * In interviews: "I defined each pipeline stage as an interface so I can
 * swap Groq for a local model without touching the retrieval logic."
 *
 * Why interfaces and not abstract classes?
 * Interfaces have zero runtime cost — they're erased at compile time.
 * Abstract classes ship JavaScript. For pure type contracts, interfaces win.
 */

import type { Result, Chunk, RetrievedChunk } from '@nimbus/config';

// =============================================================
// Stage 1: Chunker
// Responsibility: Split a raw text document into overlapping segments
// =============================================================

export interface ChunkOptions {
  maxTokens: number;
  overlap: number;
}

/**
 * PATTERN: Strategy — Chunker interface.
 * Implementations: FixedSizeChunker, SentenceChunker, MarkdownChunker
 */
export interface Chunker {
  /**
   * Split raw text into chunks suitable for embedding.
   * @param text - Raw document text (post-parse)
   * @param documentId - Parent document ID for FK on each chunk
   * @param options - Chunking parameters (maxTokens, overlap)
   * @returns Result<Chunk[]> — never throws; errors surfaced in Result
   */
  chunk(
    text: string,
    documentId: string,
    options?: Partial<ChunkOptions>
  ): Result<Chunk[]>;
}

// =============================================================
// Stage 2: Embedder
// Responsibility: Convert text → high-dimensional float vector
// =============================================================

/**
 * PATTERN: Strategy — Embedder interface.
 * Implementations: GroqEmbedder, LocalEmbedder (via @xenova/transformers)
 *
 * [INTERVIEW ANCHOR] Embedding is a learned mapping from text to a vector space
 * where semantic similarity = geometric proximity (cosine distance).
 */
export interface Embedder {
  /**
   * Embed a single text string into a float vector.
   * @param text - The text to embed (typically a chunk or a query)
   * @returns Result<number[]> — the embedding vector; length = EMBEDDING_DIM
   */
  embed(text: string): Promise<Result<number[]>>;

  /**
   * Batch embed multiple texts — more efficient than calling embed() in a loop.
   * Default implementation calls embed() sequentially; providers may override
   * with a batch API call.
   */
  embedBatch(texts: string[]): Promise<Result<number[][]>>;
}

// =============================================================
// Stage 3: Retriever
// Responsibility: Given a query embedding, find the top-k most similar chunks
// =============================================================

export interface RetrievalOptions {
  topK: number;
  /** Minimum similarity score threshold [0, 1]. Chunks below this are discarded. */
  minScore?: number;
}

/**
 * PATTERN: Strategy — Retriever interface.
 * Implementations: PgVectorRetriever, HybridRetriever (dense + BM25)
 */
export interface Retriever {
  /**
   * Retrieve the top-k most semantically similar chunks for a given query embedding.
   * @param queryEmbedding - The embedded query vector
   * @param options - topK count and optional minimum score filter
   * @returns Result<RetrievedChunk[]> — ranked by similarity, descending
   */
  retrieve(
    queryEmbedding: number[],
    options?: Partial<RetrievalOptions>
  ): Promise<Result<RetrievedChunk[]>>;
}

// =============================================================
// Stage 4: Reranker
// Responsibility: Re-score retrieved chunks for precision before LLM context
// =============================================================

/**
 * PATTERN: Strategy — Reranker interface.
 * Implementations: HeuristicReranker (position + score), CrossEncoderReranker
 *
 * [INTERVIEW ANCHOR] Two-stage retrieval (ANN + rerank) is standard in production RAG.
 * ANN retrieves fast but approximate; the reranker applies a slower, more precise model
 * to the top-k candidates. This is identical to how search engines work (BM25 → Learning-to-Rank).
 */
export interface Reranker {
  /**
   * Re-score and reorder a set of retrieved chunks against the original query.
   * @param query - The original query text
   * @param chunks - Chunks from the retrieval stage
   * @returns Result<RetrievedChunk[]> — reordered by reranker score
   */
  rerank(
    query: string,
    chunks: RetrievedChunk[]
  ): Promise<Result<RetrievedChunk[]>>;
}

// =============================================================
// Stage 5: Generator
// Responsibility: Build the prompt context and stream LLM response
// =============================================================

export interface GeneratorOptions {
  /** Maximum tokens for the LLM response */
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

/**
 * PATTERN: Strategy — Generator interface.
 * Implementations: GroqGenerator, AnthropicGenerator
 */
export interface Generator {
  /**
   * Stream an LLM response given a query and retrieved context chunks.
   * @param query - The original user query
   * @param context - Reranked chunks to inject as context
   * @param options - LLM generation parameters
   * @returns Result<ReadableStream> — SSE-compatible stream for Next.js Route Handlers
   */
  generate(
    query: string,
    context: RetrievedChunk[],
    options?: GeneratorOptions
  ): Promise<Result<ReadableStream>>;
}
