import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every integration suite boots its own Docker containers (Postgres, Redis,
    // Kafka, Nginx). Running the files in parallel starves CPU/IO during heavy
    // container boots, which makes the tight 5s WS/broadcast windows flake.
    // Run files one at a time for deterministic results.
    fileParallelism: false,
    hookTimeout: 120000,
    testTimeout: 15000,
  },
});
