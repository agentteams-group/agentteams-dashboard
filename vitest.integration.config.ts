import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Integration-suite config (task 16 / B-C1): runs the env-gated regression
// suites under src/__tests__/integration against LIVE backends. Not part of
// the default `npm test` pass (they are excluded there); invoke explicitly:
//   STORAGE_REGRESSION=1 AGENTTEAMS_FS_*... npm run test:integration
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      react: path.resolve(__dirname, './node_modules/react'),
      'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
    },
  },
  test: {
    environment: 'node',
    // Narrow on purpose: each integration suite needs a compatible
    // environment; model-skill-audit.test.ts predates this config and runs
    // under a different harness — add suites here one by one after checking
    // their env requirements.
    include: ['src/__tests__/integration/storage-regression.test.ts'],
    testTimeout: 60_000,
  },
});
