import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  collectBundleMetrics,
  collectSourceLineMetrics,
  findWhitelistGrowth,
  loadBaselineFromGit,
  validateBundleMetrics,
  validateSourceLineMetrics,
} from './check-quality-gates.mjs';

function write(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function withTempRepo(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dashboard-quality-gates-'));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function createBundleFixture(root) {
  const nextDir = path.join(root, '.next');
  const pageDir = path.join(nextDir, 'server', 'app', 'page');
  const chunksDir = path.join(nextDir, 'static', 'chunks');
  mkdirSync(pageDir, { recursive: true });
  mkdirSync(chunksDir, { recursive: true });

  write(path.join(pageDir, 'build-manifest.json'), JSON.stringify({
    polyfillFiles: ['static/chunks/polyfill.js'],
    rootMainFiles: ['static/chunks/not-used.js'],
    rootMainFilesTree: { '/page': ['static/chunks/runtime.js'] },
  }));
  write(path.join(nextDir, 'server', 'app', 'page_client-reference-manifest.js'), [
    'globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};',
    'globalThis.__RSC_MANIFEST["/page"] = ' + JSON.stringify({
      entryJSFiles: {
        '[project]/src/app/layout': ['static/chunks/layout.js'],
        '[project]/src/app/page': ['static/chunks/page.js', 'static/chunks/runtime.js'],
      },
    }) + ';',
    '',
  ].join('\n'));
  write(path.join(pageDir, 'react-loadable-manifest.json'), JSON.stringify({
    1: { id: 1, files: ['static/chunks/async.js', 'static/chunks/page.js', 'static/chunks/async.css'] },
  }));

  for (const name of ['polyfill', 'runtime', 'layout', 'async', 'nested', 'worker', 'worker-dep']) {
    write(path.join(chunksDir, `${name}.js`), `/* ${name} */\n${name.repeat(100)}`);
  }
  write(path.join(chunksDir, 'page.js'), [
    '/* page */',
    '(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push([{},100,s=>{',
    's.v(t=>Promise.all(["static/chunks/turbo.js","static/chunks/page.js"].map(t=>s.l(t))).then(()=>t(200)))',
    '}]);',
  ].join('\n'));
  write(path.join(chunksDir, 'turbo.js'), [
    '(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push([{},101,s=>{',
    's.v(t=>Promise.all(["static/chunks/nested.js"].map(t=>s.l(t))).then(()=>t(201)))',
    '},102,e=>{e.v(e.r(999).f("static/chunks/worker.js",["static/chunks/worker-dep.js"]))}]);',
  ].join('\n'));
}

const bundleConfig = {
  route: '/',
  initial: { maxGzipBytes: 1024, maxFiles: 20 },
  asyncGroup: { maxGzipBytes: 1024, maxFiles: 20 },
};

const sourceConfig = {
  root: 'src',
  maxLines: 800,
  extensions: ['.ts', '.tsx'],
  excludeDirectories: ['__tests__', 'integration'],
  excludePatterns: ['**/*.test.*', '**/*.spec.*'],
  baseline: [{ path: 'src/baseline.ts', maxLines: 900 }],
};

test('bundle metrics include loadable, nested Turbopack, and worker groups without double counting', () => {
  withTempRepo((root) => {
    createBundleFixture(root);
    const metrics = collectBundleMetrics(root, bundleConfig);
    assert.equal(metrics.initial.files, 3);
    assert.equal(metrics.legacyPolyfills.files, 1);
    assert.equal(metrics.asyncGroups.length, 4);
    assert.equal(metrics.asyncGroups.find((group) => group.id === 'loadable:1').files, 1);
    assert.equal(metrics.asyncGroups.find((group) => group.id === 'turbopack:100').files, 1);
    assert.equal(metrics.asyncGroups.find((group) => group.id === 'turbopack:101').files, 1);
    assert.equal(metrics.asyncGroups.find((group) => group.id === 'worker:102').files, 2);
    assert.equal(metrics.reachable.files, 8);
    assert.equal(metrics.allChunks.files, 9);
    assert.deepEqual(metrics.unassignedAsyncChunks, []);
    assert.deepEqual(metrics.missingLoadableGroups, []);

    const page = metrics.initial.chunks.find((chunk) => chunk.file.endsWith('/page.js'));
    assert.equal(page.gzipBytes, gzipSync(Buffer.from([
      '/* page */',
      '(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push([{},100,s=>{',
      's.v(t=>Promise.all(["static/chunks/turbo.js","static/chunks/page.js"].map(t=>s.l(t))).then(()=>t(200)))',
      '}]);',
    ].join('\n')), { level: 9 }).length);
  });
});

test('bundle budgets deduplicate identical increments and preserve same-id variants', () => {
  withTempRepo((root) => {
    createBundleFixture(root);
    write(path.join(root, '.next', 'static', 'chunks', 'page.js'), [
      '(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push([{},100,s=>{',
      's.v(t=>Promise.all(["static/chunks/async.js"].map(t=>s.l(t))).then(()=>t(200)))',
      '},100,s=>{s.v(t=>Promise.all(["static/chunks/nested.js"].map(t=>s.l(t))).then(()=>t(201)))}]);',
    ].join('\n'));

    const metrics = collectBundleMetrics(root, bundleConfig);
    assert.equal(metrics.asyncGroups.length, 2);
    const combined = metrics.asyncGroups.find((group) => group.source === 'combined');
    assert.equal(combined.id, 'loadable:1 + turbopack:100#1');
    assert.equal(combined.files, 1);
    const variant = metrics.asyncGroups.find((group) => group.id === 'turbopack:100#2');
    assert.equal(variant.files, 1);
    assert.deepEqual(metrics.unassignedAsyncChunks, []);
  });
});

test('bundle validation reports size, file-count, and async coverage violations', () => {
  const metrics = {
    initial: { files: 21, gzipBytes: 2048 },
    asyncGroups: [{ id: 'chat', files: 2, gzipBytes: 4096 }],
    unassignedAsyncChunks: ['static/chunks/orphan.js'],
    missingLoadableGroups: ['999'],
  };
  const violations = validateBundleMetrics(metrics, bundleConfig);
  assert.deepEqual(violations.map((violation) => violation.kind), [
    'initial-gzip',
    'initial-files',
    'async-gzip',
    'async-coverage',
    'lazy-manifest-coverage',
  ]);
});

test('bundle collector rejects unsupported routes and unassigned lazy chunks', () => {
  withTempRepo((root) => {
    createBundleFixture(root);
    assert.throws(() => collectBundleMetrics(root, { route: '/other' }), /support only the root route/);

    write(path.join(root, '.next', 'static', 'chunks', 'page.js'), [
      '(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push([{},100,s=>{',
      's.v(t=>Promise.all(["static/chunks/turbo.js","static/chunks/page.js"].map(t=>s.l(t))).then(()=>t(200)))',
      '}]);',
      'const uncovered = "static/chunks/orphan.js";',
      'const lazy = {loadableGenerated:{modules:[999]}};',
    ].join('\n'));
    write(path.join(root, '.next', 'static', 'chunks', 'orphan.js'), '/* orphan */');

    const metrics = collectBundleMetrics(root, bundleConfig);
    assert.deepEqual(metrics.unassignedAsyncChunks, ['static/chunks/orphan.js']);
    assert.deepEqual(metrics.missingLoadableGroups, ['999']);
    assert.deepEqual(
      validateBundleMetrics(metrics, bundleConfig).map((violation) => violation.kind),
      ['async-coverage', 'lazy-manifest-coverage'],
    );
  });
});

test('source scan excludes tests and reports new and baseline-grown files', () => {
  withTempRepo((root) => {
    write(path.join(root, 'src', 'big.ts'), `${'x\n'.repeat(801)}x`);
    write(path.join(root, 'src', 'baseline.ts'), 'x\n'.repeat(900));
    write(path.join(root, 'src', 'small.ts'), 'x\n');
    write(path.join(root, 'src', 'big.test.ts'), 'x\n'.repeat(1000));
    write(path.join(root, 'src', '__tests__', 'ignored.ts'), 'x\n'.repeat(1000));

    const metrics = collectSourceLineMetrics(root, sourceConfig);
    assert.equal(metrics.scannedFiles, 3);
    assert.deepEqual(metrics.overLimit.map((file) => file.file), ['src/baseline.ts', 'src/big.ts']);

    const result = validateSourceLineMetrics(metrics, sourceConfig);
    assert.deepEqual(result.exceptions.map((file) => file.file), ['src/baseline.ts']);
    assert.deepEqual(result.violations.map((violation) => violation.kind), ['new-over-limit-file']);
  });
});

test('source line counting handles CRLF, exact limits, and missing final newlines', () => {
  withTempRepo((root) => {
    write(path.join(root, 'src', 'exact.ts'), Array(800).fill('x').join('\r\n'));
    write(path.join(root, 'src', 'exact-newline.ts'), `${Array(800).fill('x').join('\r\n')}\r\n`);
    write(path.join(root, 'src', 'over.ts'), Array(801).fill('x').join('\r\n'));

    const metrics = collectSourceLineMetrics(root, sourceConfig);
    assert.equal(metrics.linesByPath.get('src/exact.ts'), 800);
    assert.equal(metrics.linesByPath.get('src/exact-newline.ts'), 800);
    assert.equal(metrics.linesByPath.get('src/over.ts'), 801);
    assert.deepEqual(metrics.overLimit.map((file) => file.file), ['src/over.ts']);
  });
});

test('baseline growth and stale entries are rejected', () => {
  const metrics = {
    scannedFiles: 1,
    overLimit: [{ file: 'src/baseline.ts', lines: 901 }],
    linesByPath: new Map([['src/baseline.ts', 901]]),
  };
  const result = validateSourceLineMetrics(metrics, sourceConfig);
  assert.deepEqual(result.violations.map((violation) => violation.kind), ['baseline-file-grew']);

  const staleMetrics = {
    scannedFiles: 1,
    overLimit: [],
    linesByPath: new Map([['src/baseline.ts', 100]]),
  };
  const staleResult = validateSourceLineMetrics(staleMetrics, sourceConfig);
  assert.deepEqual(staleResult.violations.map((violation) => violation.kind), ['stale-baseline-entry']);
});

test('whitelist ratchet rejects new paths and raised limits', () => {
  const base = [{ path: 'src/a.ts', maxLines: 900 }];
  const current = [
    { path: 'src/a.ts', maxLines: 900 },
    { path: 'src/b.ts', maxLines: 950 },
  ];
  assert.deepEqual(findWhitelistGrowth(current, base).map((violation) => violation.kind), ['whitelist-path-added']);
  assert.deepEqual(
    findWhitelistGrowth([{ path: 'src/a.ts', maxLines: 901 }], base).map((violation) => violation.kind),
    ['whitelist-limit-raised'],
  );
  assert.deepEqual(findWhitelistGrowth([{ path: 'src/a.ts', maxLines: 800 }], base), []);
});

test('CLI warning mode exits zero while strict mode fails on bundle and line violations', () => {
  withTempRepo((root) => {
    createBundleFixture(root);
    write(path.join(root, 'src', 'big.ts'), 'x\n'.repeat(801));
    write(path.join(root, 'src', 'baseline.ts'), 'x\n'.repeat(900));
    const configPath = path.join(root, 'scripts', 'quality-gates.config.json');
    write(configPath, JSON.stringify({
      bundle: {
        route: '/',
        initial: { maxGzipBytes: 1, maxFiles: 1 },
        asyncGroup: { maxGzipBytes: 1, maxFiles: 1 },
      },
      sourceLines: sourceConfig,
    }));

    const script = path.resolve('scripts/check-quality-gates.mjs');
    const common = ['--root', root, '--config', 'scripts/quality-gates.config.json', '--json'];
    const baseEnv = { ...process.env };
    delete baseEnv.GITHUB_BASE_REF;
    delete baseEnv.QUALITY_GATES_BASE_REF;
    for (const command of ['bundle', 'lines']) {
      const args = [script, command, ...common];
      const warning = spawnSync(process.execPath, [...args, '--warn-only'], { encoding: 'utf8', env: baseEnv });
      assert.equal(warning.status, 0, warning.stderr);
      assert.equal(JSON.parse(warning.stdout).warnOnly, true);

      const strict = spawnSync(process.execPath, args, { encoding: 'utf8', env: baseEnv });
      assert.equal(strict.status, 1, strict.stderr);
      assert.ok(JSON.parse(strict.stdout).violations.length > 0);
    }

    const pullRequestEnv = { ...baseEnv, GITHUB_BASE_REF: 'main', QUALITY_GATES_BASE_REF: 'origin/main' };
    const bundleInPullRequest = spawnSync(process.execPath, [
      script, 'bundle', ...common, '--warn-only',
    ], { encoding: 'utf8', env: pullRequestEnv });
    assert.equal(bundleInPullRequest.status, 0, bundleInPullRequest.stderr);
    assert.equal(JSON.parse(bundleInPullRequest.stdout).baseRef, undefined);
  });
});

test('CLI rejects missing option values and operational errors even in warning mode', () => {
  withTempRepo((root) => {
    const script = path.resolve('scripts/check-quality-gates.mjs');
    const missingValue = spawnSync(process.execPath, [script, 'lines', '--base-ref'], { encoding: 'utf8' });
    assert.equal(missingValue.status, 2);
    assert.match(missingValue.stderr, /Missing value for --base-ref/);

    const configPath = path.join(root, 'scripts', 'quality-gates.config.json');
    write(configPath, JSON.stringify({ bundle: bundleConfig, sourceLines: sourceConfig }));
    const missingBuild = spawnSync(process.execPath, [
      script, 'bundle', '--root', root, '--config', 'scripts/quality-gates.config.json', '--warn-only',
    ], { encoding: 'utf8' });
    assert.equal(missingBuild.status, 2);
    assert.match(missingBuild.stderr, /Run a production build first/);
  });
});

test('missing baseline config on first introduction skips the ratchet', () => {
  withTempRepo((root) => {
    const configPath = path.join(root, 'scripts', 'quality-gates.config.json');
    const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    const commit = (message) => git([
      '-c', 'user.name=Quality Gate Test',
      '-c', 'user.email=quality-gate@example.invalid',
      'commit', '-m', message,
    ]);

    git(['init']);
    write(configPath, JSON.stringify({ sourceLines: sourceConfig }));
    git(['add', 'scripts/quality-gates.config.json']);
    commit('add baseline');
    assert.deepEqual(loadBaselineFromGit(root, configPath, 'HEAD'), sourceConfig.baseline);

    rmSync(configPath);
    git(['add', '-u']);
    commit('remove baseline');
    assert.equal(loadBaselineFromGit(root, configPath, 'HEAD'), null);
  });
});
