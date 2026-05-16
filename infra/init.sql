-- Project Nimbus — PostgreSQL Initialization Script
-- This script runs ONCE when the Docker container is first created.
-- It enables the pgvector extension in the nimbus_db database.
--
-- [INTERVIEW ANCHOR] CREATE EXTENSION is idempotent with IF NOT EXISTS.
-- pgvector adds: vector type, <-> (L2), <#> (inner product), <=> (cosine) operators,
-- and HNSW / IVFFlat index methods.

\c nimbus_db;

CREATE EXTENSION IF NOT EXISTS vector;

-- Verify extension loaded correctly
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
