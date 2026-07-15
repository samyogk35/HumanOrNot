import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The backend suite runs in Node. The frontend has its own Vitest setup
    // (jsdom + Testing Library) under frontend/; exclude it here so a root run
    // doesn't try to render React components in a Node environment.
    // '**/._*' skips macOS AppleDouble resource-fork files the external drive
    // spawns next to each source file (binary; esbuild can't parse them).
    exclude: ['**/node_modules/**', '**/dist/**', 'frontend/**', '**/._*'],
    // Every integration suite boots its own Docker containers (Postgres, Redis,
    // Kafka, Nginx). Running the files in parallel starves CPU/IO during heavy
    // container boots, which makes the tight 5s WS/broadcast windows flake.
    // Run files one at a time for deterministic results.
    fileParallelism: false,
    hookTimeout: 120000,
    testTimeout: 15000,
  },
});
