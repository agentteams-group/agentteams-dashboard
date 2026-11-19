import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const source = readFileSync(new URL('./agentteams-install.sh', import.meta.url), 'utf8');
const functions = ['_ver_lt', 'configure_unified_entry_version', 'prepare_unified_entry', 'unified_entry_url', 'dashboard_browser_url']
  .map(name => source.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'm'))?.[0] ?? assert.fail(`Missing ${name}`)).join('\n');

for (const [version, override, mode] of [['v1.2.7', '', '0'], ['v1.2.8', '', '1'], ['v1.3.0', '', '1'], ['v1.2.8', '0', '0']]) {
  test(`${version} uses entry mode ${mode} with override '${override}'`, () => {
    const result = spawnSync('bash', ['-c', `set -e
      ${functions}
      error() { echo "$*" >&2; }
      AGENTTEAMS_VERSION=${version}; AGENTTEAMS_UNIFIED_ENTRY='${override}'
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
