/**
 * @module smoke.test
 * @description Day 01 smoke test — verifies environment and OpenAI connectivity.
 * Run with: pnpm test
 *
 * This is NOT a unit test of business logic.
 * It confirms three things:
 *   1. OPENAI_API_KEY is set and valid
 *   2. text-embedding-3-small returns a 1536-dim vector
 *   3. EMBEDDING_DIM constant matches reality
 */

import { describe, it, expect } from 'vitest';
import OpenAI from 'openai';
import { EMBEDDING_DIM, OPENAI_EMBEDDING_MODEL } from '@nimbus/config';

describe('Day 01 Smoke Test', () => {
  it('EMBEDDING_DIM constant is 1536', () => {
    expect(EMBEDDING_DIM).toBe(1536);
  });

  it('OpenAI embedding returns correct dimension', async () => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey.includes('REPLACE_ME')) {
      console.warn('Skipping OpenAI test — OPENAI_API_KEY not set');
      return;
    }

    const client = new OpenAI({ apiKey });
    const response = await client.embeddings.create({
      model: OPENAI_EMBEDDING_MODEL,
      input: 'Project Nimbus smoke test',
    });

    const first = response.data[0];
    if (!first) throw new Error('No embedding returned from OpenAI API');
    const vector = first.embedding;
    expect(vector).toHaveLength(EMBEDDING_DIM);
    console.log(`✓ Embedding dimension: ${vector.length} (matches EMBEDDING_DIM)`);
  }, 15_000); // 15s timeout for API call
});
