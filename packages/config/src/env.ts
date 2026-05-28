/**
 * @module env
 * @description Zod-validated environment schema. Imported once at app startup.
 * If any required variable is missing or malformed, the process throws immediately.
 *
 * PATTERN: Fail Fast — crash at startup with a clear error rather than failing
 * silently during the first API call 10 minutes into a demo.
 */

import { z } from 'zod';

const envSchema = z.object({
  // LLM providers
  GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY is required'),
  // Anthropic is optional — only required when using the fallback provider
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // Embeddings — OpenAI text-embedding-3-small
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),

  // Database — must be a valid URL
  // [INTERVIEW ANCHOR] URL validation at startup prevents runtime connection errors
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection URL'),

  // Application runtime
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  NEXT_PUBLIC_APP_URL: z
    .string()
    .url()
    .default('http://localhost:3000'),
});

// PATTERN: Fail Fast with escape hatch for test environments.
// Set SKIP_ENV_VALIDATION=1 in vitest setup to bypass validation in unit tests.
// [INTERVIEW ANCHOR] "Fail Fast" means crashing at startup (not at the first API call during
// a live demo). The safeParse variant lets us emit a human-readable error instead of a raw
// Zod stack trace while preserving the same startup-crash guarantee.
const isEdgeRuntime =
  typeof process !== 'undefined' && process.env['NEXT_RUNTIME'] === 'edge';
const skipValidation =
  typeof process !== 'undefined' && process.env['SKIP_ENV_VALIDATION'] === '1';

export type Env = z.infer<typeof envSchema>;

const parsed =
  skipValidation || isEdgeRuntime
    ? ({ success: true, data: process.env } as z.SafeParseSuccess<Env>)
    : envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[nimbus/config] ❌ Invalid environment variables:');
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  throw new Error(
    '[nimbus/config] Invalid environment variables — see above for details.'
  );
}

export const env = parsed.data as Env;
