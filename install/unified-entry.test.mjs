import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const source = readFileSync(new URL('./agentteams-install.sh', import.meta.url), 'utf8');
test('upgrade recognizes a prior unified default image and selects the released patch', () => {
  const setup = ['prepare_upgrade_dashboard', 'prepare_unified_entry']
    .map(name => source.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'm'))[0]).join('\n');
  const result = spawnSync('bash', ['-c', `set -e
    ${setup}
    AGENTTEAMS_REGISTRY=test; AGENTTEAMS_DASHBOARD=1; AGENTTEAMS_UNIFIED_ENTRY=1
    AGENTTEAMS_DASHBOARD_VERSION=v1.4.2
    AGENTTEAMS_DASHBOARD_IMAGE=test/agentteams/agentteams-dashboard:v1.4.2-unified
    prepare_upgrade_dashboard; prepare_unified_entry
    printf '%s' "$AGENTTEAMS_DASHBOARD_IMAGE"
  `], {encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,'test/agentteams/agentteams-dashboard:v1.4.3-unified');
});
test('Harness release defaults follow Core and explicit runtime pins remain effective', () => {
  const resolve = ['_normalize_version', '_ver_lt', '_supports_deepseek_harness', 'resolve_image_tags']
    .map(name => source.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'm'))[0]).join('\n');
  for (const version of ['v1.2.8', 'v1.2.9']) {
    const result = spawnSync('bash', ['-c', `set -e
      ${resolve}
      AGENTTEAMS_VERSION=${version}; AGENTTEAMS_REGISTRY=registry
      AGENTTEAMS_DEEPSEEK_HARNESS_MIN_VERSION=v1.2.4
      resolve_image_tags
      printf '%s\\n' "$DEEPSEEK_HARNESS_WORKER_IMAGE" "$CODEX_WORKER_IMAGE"
      AGENTTEAMS_CODEX_WORKER_VERSION=v9.8.7
      resolve_image_tags
      printf '%s' "$CODEX_WORKER_IMAGE"
    `], {encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `registry/agentteams/agentteams-harness-deepseek:${version}\nregistry/agentteams/agentteams-harness-codex:${version}\nregistry/agentteams/agentteams-harness-codex:v9.8.7`);
  }
});
const functions = ['_ver_lt', 'configure_unified_entry_version', 'prepare_unified_entry', 'unified_entry_url', 'dashboard_browser_url']
  .map(name => source.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'm'))?.[0] ?? assert.fail(`Missing ${name}`)).join('\n');

for (const [version, override, mode, upgrade = '0'] of [['v1.2.7', '', '0'], ['v1.2.8', '', '1'], ['v1.3.0', '', '1'], ['v1.2.8', '0', '0'], ['v1.2.8', '', '0', '1'], ['v1.2.8', '1', '1', '1']]) {
  test(`${version} uses entry mode ${mode} with override '${override}'`, () => {
    const result = spawnSync('bash', ['-c', `set -e
      ${functions}
      error() { echo "$*" >&2; }
      AGENTTEAMS_VERSION=${version}; AGENTTEAMS_UNIFIED_ENTRY='${override}'; AGENTTEAMS_UPGRADE=${upgrade}
      AGENTTEAMS_REGISTRY=registry; AGENTTEAMS_DASHBOARD=1; AGENTTEAMS_DASHBOARD_VERSION=v9.0.0
      DASHBOARD_CONTAINER=dashboard; AGENTTEAMS_ENTRY_EXTERNAL_URL=https://at.example.com/
      AGENTTEAMS_DATA_DIR=old-data; AGENTTEAMS_WORKSPACE_DIR=old-workspace
      configure_unified_entry_version
      prepare_unified_entry
      printf '%s\\n' "$AGENTTEAMS_UNIFIED_ENTRY" "$AGENTTEAMS_DASHBOARD_IMAGE" "$AGENTTEAMS_DATA_DIR" "$AGENTTEAMS_WORKSPACE_DIR"
      dashboard_browser_url
    `], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const [actualMode, image, data, workspace, url] = result.stdout.split('\n');
    assert.equal(actualMode, mode);
    assert.equal(image, `registry/agentteams/agentteams-dashboard:v9.0.0${mode === '1' ? '-unified' : ''}`);
    assert.equal(data, 'old-data');
    assert.equal(workspace, 'old-workspace');
    assert.equal(url, mode === '1' ? 'https://at.example.com/dashboard/' : 'http://127.0.0.1:13000/');
  });
}
