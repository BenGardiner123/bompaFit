import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path alias in tsconfig.json.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  // tsconfig says `jsx: preserve` because Next.js does the transform. Vitest
  // compiles the files itself, so it needs to be told.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'state/**/*.test.tsx', 'components/**/*.test.tsx'],
    // fake-indexeddb/auto installs a working IndexedDB onto globalThis so the
    // Dexie tests exercise the real driver rather than a hand-rolled mock.
    setupFiles: ['./test/setup.ts'],
  },
});
