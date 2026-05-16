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

// This runs at module load time — if validation fails, process.exit() equivalent
// Only validate in non-test environments to allow unit tests without a real DB
export const env = envSchema.parse(
  typeof process !== 'undefined' ? process.env : {}
);

export type Env = z.infer<typeof envSchema>;
