import { describe, expect, it } from 'vitest';
import {
  indexModules,
  installedVersionsLabel,
  moduleUpdateState,
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
