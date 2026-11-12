import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Each test file spins up its own in-memory PGlite; give WASM start-up some room.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
