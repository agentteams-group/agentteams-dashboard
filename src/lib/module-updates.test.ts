import { describe, expect, it } from 'vitest';
import {
  buildModuleVersionOptions,
  compareModuleVersions,
  indexModules,
  installedVersionsLabel,
  moduleInstallDirection,
  moduleUpdateState,
  pickDefaultModuleVersion,
  type MillforgeIndex,
} from './module-updates';

describe('moduleUpdateState', () => {
  it('flags an older installed version as update-available', () => {
    expect(moduleUpdateState(['0.1.0'], '0.2.0')).toBe('update-available');
    expect(moduleUpdateState(['v0.9.9'], '1.0.0')).toBe('update-available');
  });

  it('treats equal or newer installed versions as up to date', () => {
    expect(moduleUpdateState(['0.2.0'], '0.2.0')).toBe('uptodate');
    expect(moduleUpdateState(['0.3.0'], '0.2.0')).toBe('uptodate');
  });

  it('flags a team aggregate when any member is behind latest', () => {
    expect(moduleUpdateState(['0.2.0', '0.1.0'], '0.2.0')).toBe('update-available');
    expect(moduleUpdateState(['0.2.0', '0.2.0'], '0.2.0')).toBe('uptodate');
  });

  it('distinguishes not-installed from an unknown latest', () => {
    expect(moduleUpdateState([], '0.2.0')).toBe('not-installed');
    expect(moduleUpdateState(undefined, '0.2.0')).toBe('not-installed');
    expect(moduleUpdateState(['0.1.0'], null)).toBe('unknown');
    expect(moduleUpdateState([], '')).toBe('unknown');
  });
});

describe('indexModules', () => {
  const index: MillforgeIndex = {
    schema: 1,
    channel: 'beta',
    source: 'github',
    repo: 'LUOSENGWA/millforge',
    fetched_at: '2026-11-07T00:00:00Z',
    modules: {
      teamharness: { kind: 'plugin', latest: '0.1.0' },
      'agentteams-matrix': {
        kind: 'bundle',
        pluginId: 'agentteams-matrix-channel',
        latest: '0.1.0',
      },
      looprunner: { kind: 'runner', latest: null, note: 'reserved' },
    },
  };

  it('falls back to the module key as pluginId and sorts rows', () => {
    const rows = indexModules(index);
    expect(rows.map((row) => row.module)).toEqual([
      'agentteams-matrix',
      'looprunner',
      'teamharness',
    ]);
    expect(rows[0].pluginId).toBe('agentteams-matrix-channel');
    expect(rows[1].pluginId).toBe('looprunner');
    expect(rows[2].kind).toBe('plugin');
  });

  it('keeps a null latest (reserved module) rather than inventing a version', () => {
    const looprunner = indexModules(index).find((row) => row.module === 'looprunner');
    expect(looprunner?.latest).toBeNull();
    expect(looprunner?.note).toBe('reserved');
  });

  it('returns nothing for a missing index', () => {
    expect(indexModules(undefined)).toEqual([]);
    expect(indexModules(null)).toEqual([]);
  });
});

describe('installedVersionsLabel', () => {
  it('deduplicates and joins versions, or reports not installed', () => {
    expect(installedVersionsLabel(['0.1.0', '0.1.0'])).toBe('0.1.0');
    expect(installedVersionsLabel(['0.1.0', '0.2.0'])).toBe('0.1.0 / 0.2.0');
    expect(installedVersionsLabel([])).toBe('未安装');
    expect(installedVersionsLabel(undefined)).toBe('未安装');
  });
});

describe('compareModuleVersions', () => {
  it('keeps prerelease ordering that compareSemver collapses', () => {
    expect(compareModuleVersions('0.1.1-alpha.1', '0.1.1-alpha.2')).toBeLessThan(0);
    expect(compareModuleVersions('0.1.1-alpha.2', '0.1.1-alpha.10')).toBeLessThan(0);
    expect(compareModuleVersions('0.1.1-beta', '0.1.1-alpha.9')).toBeGreaterThan(0);
    expect(compareModuleVersions('0.1.1', '0.1.1-alpha.9')).toBeGreaterThan(0);
    expect(compareModuleVersions('v0.2.0', '0.1.9')).toBeGreaterThan(0);
  });

  it('flags a prerelease bump as update-available', () => {
    expect(moduleUpdateState(['0.1.1-alpha.1'], '0.1.1-alpha.2')).toBe('update-available');
    expect(moduleUpdateState(['0.1.1-alpha.2'], '0.1.1-alpha.2')).toBe('uptodate');
  });
});

describe('buildModuleVersionOptions', () => {
  const entry = {
    versions: {
      '0.1.0': { artifacts: [{ name: 'a.zip', sha256: 'a' }] },
      '0.1.1-alpha.1': { artifacts: [{ name: 'b.zip', sha256: 'b' }] },
      '0.1.1-alpha.2': { artifacts: [{ name: 'c.zip', sha256: 'c' }] },
      '0.2.0': { artifacts: [{ name: 'meta.txt', sha256: 'd' }] },
      '0.3.0': {},
    },
  };

  it('lists newest first, disables the current and non-zip versions', () => {
    const options = buildModuleVersionOptions(entry, '0.1.0');
    expect(options.map((option) => option.value)).toEqual([
      '0.3.0',
      '0.2.0',
      '0.1.1-alpha.2',
      '0.1.1-alpha.1',
      '0.1.0',
    ]);
    expect(options[0]).toMatchObject({ disabled: true, reason: 'unavailable' });
    expect(options[1]).toMatchObject({ disabled: true, reason: 'unavailable' });
    expect(options[2]).toMatchObject({ disabled: false, reason: null });
    expect(options[4]).toMatchObject({ disabled: true, reason: 'current' });
    expect(pickDefaultModuleVersion(options)).toBe('0.1.1-alpha.2');
  });

  it('returns nothing for a module without a version table', () => {
    expect(buildModuleVersionOptions(undefined, null)).toEqual([]);
    expect(pickDefaultModuleVersion([])).toBeNull();
  });
});

describe('moduleInstallDirection', () => {
  it('maps version comparison to install/update/downgrade', () => {
    expect(moduleInstallDirection('0.2.0', null)).toBe('install');
    expect(moduleInstallDirection('0.2.0', '0.1.0')).toBe('update');
    expect(moduleInstallDirection('0.1.0', '0.2.0')).toBe('downgrade');
    expect(moduleInstallDirection('0.2.0', '0.2.0')).toBe('update');
  });
});
