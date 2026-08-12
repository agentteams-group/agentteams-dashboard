// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  makePluginRecord,
  selectPluginList,
  isPluginDisabled,
  usePluginRegistry,
} from './registry';
import type { PluginManifest } from './types';

function manifest(id: string): PluginManifest {
  return { id, name: id, version: '1.0.0', entry: { dashboard: 'index.js' } };
}

function resetRegistry() {
  usePluginRegistry.setState({
    records: {},
    installedUrls: [],
    disabledIds: [],
    ready: false,
  });
}

describe('plugin registry store', () => {
  beforeEach(resetRegistry);

  it('upserts and lists plugin records', () => {
    const record = makePluginRecord(manifest('beta'), { kind: 'bundled' });
    usePluginRegistry.getState().upsertRecord(record);
    const list = selectPluginList(usePluginRegistry.getState());
    expect(list).toHaveLength(1);
    expect(list[0].manifest.id).toBe('beta');
    expect(list[0].status).toBe('installed');
  });

  it('updates status and error', () => {
    usePluginRegistry.getState().upsertRecord(makePluginRecord(manifest('x'), { kind: 'bundled' }));
    usePluginRegistry.getState().updateStatus('x', 'error', 'boom');
    const record = usePluginRegistry.getState().records['x'];
    expect(record.status).toBe('error');
    expect(record.error).toBe('boom');
  });

  it('ignores status updates for unknown plugins', () => {
    usePluginRegistry.getState().updateStatus('ghost', 'active');
    expect(usePluginRegistry.getState().records['ghost']).toBeUndefined();
  });

  it('removes a record and its disabled flag', () => {
    usePluginRegistry.getState().upsertRecord(makePluginRecord(manifest('y'), { kind: 'url', manifestUrl: 'u' }));
    usePluginRegistry.getState().setDisabled('y', true);
    usePluginRegistry.getState().removeRecord('y');
    expect(usePluginRegistry.getState().records['y']).toBeUndefined();
    expect(usePluginRegistry.getState().disabledIds).not.toContain('y');
  });

  it('tracks installed urls without duplicates', () => {
    usePluginRegistry.getState().addInstalledUrl('http://a/plugin.json');
    usePluginRegistry.getState().addInstalledUrl('http://a/plugin.json');
    usePluginRegistry.getState().addInstalledUrl('http://b/plugin.json');
    expect(usePluginRegistry.getState().installedUrls).toEqual([
      'http://a/plugin.json',
      'http://b/plugin.json',
    ]);
    usePluginRegistry.getState().removeInstalledUrl('http://a/plugin.json');
    expect(usePluginRegistry.getState().installedUrls).toEqual(['http://b/plugin.json']);
  });

  it('tracks disabled ids', () => {
    usePluginRegistry.getState().setDisabled('p', true);
    expect(isPluginDisabled(usePluginRegistry.getState(), 'p')).toBe(true);
    usePluginRegistry.getState().setDisabled('p', false);
    expect(isPluginDisabled(usePluginRegistry.getState(), 'p')).toBe(false);
  });

  it('selectPluginList sorts by id', () => {
    usePluginRegistry.getState().upsertRecord(makePluginRecord(manifest('zeta'), { kind: 'bundled' }));
    usePluginRegistry.getState().upsertRecord(makePluginRecord(manifest('alpha'), { kind: 'bundled' }));
    const ids = selectPluginList(usePluginRegistry.getState()).map((r) => r.manifest.id);
    expect(ids).toEqual(['alpha', 'zeta']);
  });
});
