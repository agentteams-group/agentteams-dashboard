import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const image = 'registry.example/agentteams/dashboard';
const commands = (target, ...args) => execFileSync('make', [
  '-n', target, 'IS_PODMAN=0', `IMAGE=${image}`, ...args,
], { cwd: root, encoding: 'utf8' });

for (const arch of ['amd64', 'arm64']) {
  test(`${arch} builds only its platform without publishing canonical tags`, () => {
    const output = commands('push-platform', `ARCH=${arch}`, 'VERSION=v1.4.0');
    assert.match(output, new RegExp(`--platform linux/${arch}\\s`));
    assert.match(output, new RegExp(`-t ${image}:v1\\.4\\.0-${arch}\\s`));
    assert.doesNotMatch(output, new RegExp(`-t ${image}:(?:latest|v1\\.4\\.0)\\s`));
    assert.match(output, /--push/);
  });
}

for (const version of ['v1.4.0', 'v1.4.0-rc.1']) {
  test(`${version} publishes both platforms together with the existing latest policy`, () => {
    const output = commands('push-manifest', `VERSION=${version}`);
    assert.match(output, /docker buildx imagetools create/);
    assert.ok(output.includes(`-t ${image}:${version}`));
    assert.ok(output.includes(`${image}:${version}-amd64`));
    assert.ok(output.includes(`${image}:${version}-arm64`));
    assert.equal(output.includes(`-t ${image}:latest`), version === 'v1.4.0');
  });
}

test('publication uses native runners and merges only after both builds succeed', () => {
  const workflow = readFileSync(new URL('.github/workflows/build.yml', root), 'utf8');
  assert.match(workflow, /arch: amd64\s+runner: ubuntu-24\.04/);
  assert.match(workflow, /arch: arm64\s+runner: ubuntu-24\.04-arm/);
  assert.match(workflow, /runs-on: \$\{\{ matrix\.runner \}\}/);
  assert.doesNotMatch(workflow, /setup-qemu-action/);
  assert.match(workflow, /make push-platform/);
  assert.match(workflow, /ARCH="\$\{\{ matrix\.arch \}\}"/);
  assert.match(workflow, /merge:\s+[^]*?needs: \[version, publish\]/);
  assert.match(workflow, /make push-manifest/);
  assert.doesNotMatch(workflow, /always\(\)/);
});
