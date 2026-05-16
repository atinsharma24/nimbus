/**
 * @module index
 * @description Public API of @nimbus/config.
 * Import everything from this barrel file, not from deep paths.
 *
 * @example
 * import { type Result, type Chunk, GROQ_CHAT_MODEL } from '@nimbus/config';
 */

export * from './types';
export * from './constants';
// Note: env is NOT re-exported here — import it directly from '@nimbus/config/env'
// to avoid triggering Zod validation in contexts that don't have process.env (e.g., edge runtime)
