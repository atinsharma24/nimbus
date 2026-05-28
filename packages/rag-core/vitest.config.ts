import { defineConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';
import path from 'path';

// Load .env.local from project root so env validation passes during tests
loadDotenv({ path: path.resolve(process.cwd(), '../../.env.local') });

export default defineConfig({
  test: {
    environment: 'node',
  },
});
