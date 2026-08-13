// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginApi } from '@/lib/plugins/api';
import { useExtensionStore } from '@/lib/plugins/extension-store';
import { pluginEventBus } from '@/lib/plugins/event-bus';
import { manifest } from './manifest';
import { activate, analyzeWorkers, buildChecks, buildReport, deactivate } from './index';

describe('wen-tian diagnostic plugin', () => {
  beforeEach(() => {
    useExtensionStore.getState().clear();
    pluginEventBus.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  function buildApi() {
    const tracked: Array<() => void> = [];
    const api = createPluginApi({ manifest, trackUnregister: (fn) => tracked.push(fn) });
    return { api, tracked };
  }

  it('declares a valid manifest with the dashboard entry', () => {
    expect(manifest.id).toBe('wen-tian');
    expect(manifest.entry.dashboard).toBeTruthy();
    expect(manifest.extensionPoints).toEqual(
      expect.arrayContaining(['sidebar-menu', 'route', 'dashboard-widget'])
    );
  });

  it('activate registers one sidebar entry, one route, one widget', () => {
    const { api } = buildApi();
    activate(api);

    const state = useExtensionStore.getState();
    expect(state.menuItems).toHaveLength(1);
    expect(state.routes).toHaveLength(1);
    expect(state.widgets).toHaveLength(1);

    expect(state.menuItems[0].pluginId).toBe('wen-tian');
    expect(state.menuItems[0].contribution.target).toEqual({
      type: 'plugin-route',
      routeId: 'diagnose',
    });
    expect(state.routes[0].contribution.id).toBe('diagnose');
    expect(state.widgets[0].contribution.id).toBe('wen-tian-health');
  });

  it('deactivate removes every contribution', () => {
    const { api } = buildApi();
    activate(api);
    expect(useExtensionStore.getState().menuItems).toHaveLength(1);

    deactivate();

    const state = useExtensionStore.getState();
    expect(state.menuItems).toHaveLength(0);
    expect(state.routes).toHaveLength(0);
    expect(state.widgets).toHaveLength(0);
  });
});

describe('wen-tian diagnostic logic', () => {
  const baseArgs = {
    cluster: { totalWorkers: 2, totalTeams: 1, totalHumans: 0, kubeMode: true },
    version: { controller: 'v1.2.0', dashboard: 'v1.2.0' },
    workers: [
      { name: 'w1', phase: 'Running' },
      { name: 'w2', phase: 'Running' },
    ],
    teams: [{ name: 't1', phase: 'Running' }],
    humans: [],
    infra: {
      minio: { healthy: true, endpoint: 'minio:9000', buckets: [] },
      higress: { healthy: true, gateway: { healthy: true }, console: { healthy: true } },
      matrix: { healthy: true, homeserver: 'matrix.local' },
    },
  };

  it('analyzeWorkers tallies phases and reports failures', () => {
    const { distribution, failures } = analyzeWorkers([
      { name: 'a', phase: 'Running' },
      { name: 'b', phase: 'Pending' },
      { name: 'c', phase: 'Failed' },
      { name: 'd', phase: 'Failed' },
      { name: 'e' },
    ]);
    expect(distribution).toEqual({ Running: 1, Pending: 1, Failed: 2, Unknown: 1 });
    expect(failures).toEqual(['c (Failed)', 'd (Failed)']);
  });

  it('buildChecks flags a degraded cluster', () => {
    const checks = buildChecks({
      ...baseArgs,
      workers: [
        { name: 'w1', phase: 'Failed' },
        { name: 'w2', phase: 'Failed' },
      ],
      infra: { minio: { healthy: false, endpoint: '', buckets: [] }, higress: undefined, matrix: { healthy: true, homeserver: '' } },
    });
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(byId['deployment-mode'].severity).toBe('ok');
    expect(byId['worker-phase'].severity).toBe('error');
    expect(byId['worker-phase'].detail).toContain('2 个 Failed');
    expect(byId['infra'].severity).toBe('warn');
    expect(byId['severity-rollup'].severity).toBe('error');
  });

  it('buildChecks reports all-green on a healthy cluster', () => {
    const checks = buildChecks(baseArgs);
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(byId['component-health'].severity).toBe('warn'); // totalHumans = 0
    expect(byId['worker-phase'].severity).toBe('ok');
    expect(byId['infra'].severity).toBe('ok');
    expect(byId['severity-rollup'].severity).toBe('warn');
  });

  it('buildReport serializes a readable markdown report', () => {
    const checks = buildChecks(baseArgs);
    const report = buildReport({ ...baseArgs, checks });
    expect(report).toContain('# 问天诊断报告');
    expect(report).toContain('- 部署模式：Kubernetes');
    expect(report).toContain('- Running: 2');
    expect(report).toContain('## 检查项');
    expect(report).toMatch(/生成时间：\d{4}-\d{2}-\d{2}T/);
  });
});