import path from 'node:path';
import { defineConfig } from 'vitest/config';

Object.assign(process.env, { NODE_ENV: 'test' });

// Live model/skill audit is intentionally separate from the default storage
// integration suite. The dev-server checks are opt-in, and Nacos mutation also
// requires an explicit allow flag so this command cannot alter shared config.
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
    include: ['src/__tests__/integration/model-skill-audit.test.ts'],
    testTimeout: 60_000,
  },
});
