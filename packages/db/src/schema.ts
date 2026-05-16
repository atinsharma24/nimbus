/**
 * @module schema
 * @description Drizzle ORM schema for Project Nimbus.
 * Defines the two core tables: documents and chunks.
 *
 * PATTERN: Schema-First — types are derived from schema, not hand-written.
 * This ensures the TypeScript type and the DB column are always in sync.
 *
 * [INTERVIEW ANCHOR] pgvector stores high-dimensional float arrays as a
 * native Postgres type. The HNSW index enables O(log n) approximate
 * nearest-neighbor search — vastly faster than brute-force O(n * dim).
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
  pgEnum,
  customType,
  uuid,
} from 'drizzle-orm/pg-core';

// =============================================================
// Custom type: vector(dim) — not natively supported by Drizzle yet,
// so we use customType to map the pgvector SQL type to a number[] in TS.
// Trade-off: We lose some type safety on the dimension, but this is the
// accepted community pattern until Drizzle adds native pgvector support.
// =============================================================
const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      // SQL type — matches the pgvector extension's type name
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]): string {
      // Serialize JS array → pgvector wire format: "[0.1, 0.2, ...]"
      return `[${value.join(',')}]`;
    },
    fromDriver(value: string): number[] {
      // Deserialize pgvector wire format → JS array
      return value
        .slice(1, -1)
        .split(',')
        .map(Number);
    },
  })(name);

// =============================================================
// Enums
// =============================================================

/**
 * Document processing status — tracks where in the ingestion pipeline
 * a document currently sits.
 */
export const documentStatusEnum = pgEnum('document_status', [
  'pending',    // uploaded, not yet processed
  'processing', // FileParser + Chunker + Embedder running
  'indexed',    // all chunks stored in pgvector, ready for retrieval
  'failed',     // pipeline error — see documents.errorMessage for details
]);

// =============================================================
// Tables
// =============================================================

/**
 * documents — parent table for user-uploaded source files.
 * One document → many chunks (one-to-many relationship).
 */
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  filename: text('filename').notNull(),
  // MIME type routes to the correct FileParser (pdf → PDFParser, md → MarkdownParser)
  mimeType: text('mime_type').notNull(),
  status: documentStatusEnum('status').notNull().default('pending'),
  // Stores the last pipeline error message for failed documents
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * chunks — sub-document segments after the Chunker stage.
 * Each chunk is independently embedded and searchable via pgvector.
 */
export const chunks = pgTable('chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  // FK to parent document — cascade delete removes chunks when document is deleted
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  // Position within the parent document — used for context window reconstruction
  chunkIndex: integer('chunk_index').notNull(),
  /**
   * The embedding vector — stores normalized L2 embedding for cosine similarity.
   * Dimension must match EMBEDDING_DIM (768) in @nimbus/config/constants.
   * Model: nomic-embed-text via Ollama (768-dim). If switching to OpenAI
   * text-embedding-3-small, change both this AND EMBEDDING_DIM to 1536.
   * [INTERVIEW ANCHOR] Changing this dimension requires re-embedding ALL documents.
   */
  embedding: vector('embedding', 768),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// =============================================================
// Exported TypeScript types derived from schema (schema-first pattern)
// Use these for type-safe query results throughout the app.
// =============================================================
export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;
export type ChunkRow = typeof chunks.$inferSelect;
export type NewChunkRow = typeof chunks.$inferInsert;
