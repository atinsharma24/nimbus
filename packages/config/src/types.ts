/**
 * @module types
 * @description Shared type contracts for the entire Nimbus monorepo.
 * All cross-package types are defined here and imported from @nimbus/config.
 * Never duplicate these definitions in other packages.
 */

// =============================================================
// PATTERN: Result Monad — explicit error handling without throw
// [INTERVIEW ANCHOR] This is the same concept as Rust's Result<T, E> type.
// It forces callers to handle both success and failure branches.
// =============================================================

/** Standardized error shape used across the entire system */
export interface AppError {
  /** Machine-readable error code for programmatic handling */
  code: string;
  /** Human-readable message for logs and debug output */
  message: string;
  /** Original error, if wrapping a thrown exception */
  cause?: unknown;
}

/**
 * Result<T, E> — the core error monad.
 * Every I/O-touching function returns this instead of throwing.
 *
 * @example
 * async function fetchDoc(id: string): Promise<Result<Document>> {
 *   const row = await db.query(...);
 *   if (!row) return { ok: false, error: { code: 'NOT_FOUND', message: `Doc ${id} not found` } };
 *   return { ok: true, value: row };
 * }
 */
export type Result<T, E extends AppError = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// =============================================================
// Domain types — Document and Chunk are the two core entities
// in the RAG pipeline. Everything else references these.
// =============================================================

/** Represents a user-uploaded source document before processing */
export interface Document {
  id: string;
  /** Original filename — e.g., "q4-report.pdf" */
  filename: string;
  /** MIME type — used to route to the correct FileParser */
  mimeType: string;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** Processing status through the ingestion pipeline */
  status: 'pending' | 'processing' | 'indexed' | 'failed';
}

/**
 * A chunk is a sub-document segment after the Chunker stage.
 * Each chunk gets independently embedded and stored in pgvector.
 */
export interface Chunk {
  id: string;
  /** FK reference back to the parent Document */
  documentId: string;
  /** The actual text content that will be embedded */
  content: string;
  /**
   * Position index within the parent document.
   * Used for reconstructing context windows around retrieved chunks.
   */
  chunkIndex: number;
  /**
   * The embedding vector — stored in pgvector as vector(1536).
   * Undefined until the Embedder stage completes.
   * [INTERVIEW ANCHOR] This is an L2-normalized float array used for cosine similarity search.
   */
  embedding?: number[];
}

/** Query from the user, enriched after the QueryEmbedder stage */
export interface Query {
  text: string;
  /** Populated after embedding — same dimension as Chunk.embedding */
  embedding?: number[];
}

/** A chunk returned from a retrieval operation, with its similarity score */
export interface RetrievedChunk extends Chunk {
  /**
   * Cosine similarity score [0, 1] — higher = more semantically similar.
   * [INTERVIEW ANCHOR] Cosine similarity = dot product of unit vectors.
   */
  score: number;
}
