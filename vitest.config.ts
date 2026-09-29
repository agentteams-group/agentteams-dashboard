import path from 'node:path';
import { defineConfig } from 'vitest/config';

// 本环境 ambient NODE_ENV=production（容器继承）→ vitest worker 加载 React
// 生产构建，而 `act` 是 dev/test-only API（生产构建剥掉）→ 322 个
// "React.act is not a function" 批量失败（2026-09-16 实测）。这里强制
// test 语义，worker 继承本进程 env，不受 ambient 值影响。
process.env.NODE_ENV = 'test';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      react: path.resolve(__dirname, './node_modules/react'),
      'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
      'react/jsx-runtime': path.resolve(__dirname, './node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': path.resolve(__dirname, './node_modules/react/jsx-dev-runtime.js'),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    // Node ≥25 webstorage 坏 stub 遮蔽 jsdom localStorage → persist store
    // 测试批量失败；setup 把 jsdom 真 Storage 挂回 globalThis（见文件头注释）。
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['src/__tests__/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'src/lib/theme/**',
        'src/lib/plugins/**',
        'src/lib/section-store.ts',
        'src/plugins/**',
        'src/components/theme/**',
        'src/components/plugins/**',
        // A8: security-critical modules (RBAC denials, audit trail, storage
        // credentials, homeserver SSRF guard, skill storage safety).
        'src/lib/rbac-engine.ts',
        'src/lib/audit-log.ts',
        'src/lib/minio-client.ts',
        'src/lib/homeserver-allowlist.ts',
        'src/lib/skill-center-storage.ts',
        'src/lib/skill-package.ts',
      ],
      // A8: per-module floors pinned at the current baseline (2026-09-29).
      // Progressive tightening: skill-center-storage is dragged down by
      // syncNacosSkills (needs a live Nacos server); raise it once that flow
      // gets a fixture-driven test, and ratchet the others upward from here.
      thresholds: {
        'src/lib/rbac-engine.ts': { lines: 100, branches: 92 },
        'src/lib/minio-client.ts': { lines: 100 },
        'src/lib/homeserver-allowlist.ts': { lines: 96, branches: 96 },
        'src/lib/audit-log.ts': { lines: 89 },
        'src/lib/skill-package.ts': { lines: 88 },
        'src/lib/skill-center-storage.ts': { lines: 39 },
      },
    },
  },
});
