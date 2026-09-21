import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // Testcontainers start-up (image pull on first run) is slow.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Integration tests share one PostgreSQL container per file; keep files sequential.
    fileParallelism: false,
  },
});
