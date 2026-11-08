import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const tree = 'a'.repeat(40);
const image = 'registry.example/dashboard:v1.4.1';
const check = new URL('./check-published-image.mjs', import.meta.url);
function run(manifest, error = '', status = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-reuse-'));
  try {
    const docker = join(dir, 'docker');
    writeFileSync(docker, '#!/bin/sh\nprintf "%s" "$MANIFEST"\nprintf "%s" "$ERROR" >&2\nexit "$STATUS"\n');
    chmodSync(docker, 0o755);
    return spawnSync(process.execPath, [check.pathname, image, tree], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`,
        MANIFEST: JSON.stringify(manifest), ERROR: error, STATUS: String(status), GITHUB_OUTPUT: join(dir, 'output') },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const manifest = {
  schemaVersion: 2,
  annotations: { 'io.agentteams.source-tree': tree },
  manifests: ['amd64', 'arm64'].map(architecture => ({ platform: { os: 'linux', architecture } })),
};
test('same source tree and both architectures reuse without building', () => {
  const r = run(manifest);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ready=true/);
});
test('only an exact not-found result allows a new publication', () => {
  const r = run(null, `ERROR: ${image}: not found`, 1);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ready=false/);
});
test('registry outages and malformed manifests stop rather than overwrite', () => {
  for (const error of ['ERROR: timeout', 'ERROR: 401 Unauthorized', 'ERROR: proxy: not found']) {
    const r = run(null, error, 1);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Cannot verify/);
  }
  const invalid = run(null);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Invalid manifest/);
});
test('an existing version with different or unverifiable provenance is immutable', () => {
  for (const other of [
    { ...manifest, annotations: {} },
    { ...manifest, annotations: { 'io.agentteams.source-tree': 'b'.repeat(40) } },
    { ...manifest, manifests: manifest.manifests.slice(0, 1) },
  ]) {
    const r = run(other);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Existing version/);
  }
});
test('Docker dependency installation opts out of optional native CUDA only in the builder', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  const [builder, runner] = dockerfile.split('FROM node:22-alpine AS runner');
  assert.match(builder, /ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip/);
  assert.doesNotMatch(runner, /ONNXRUNTIME_NODE_INSTALL_CUDA/);
  assert.match(builder, /npm ci/);
});
