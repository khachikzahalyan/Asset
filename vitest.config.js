import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
    // Only collect tests under src/. The `firestore-tests/` workspace runs
    // against the Firebase emulator and uses its own vitest config + deps;
    // it must not be picked up by the root suite (which has neither a JRE
    // nor `@firebase/rules-unit-testing` installed).
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
});
