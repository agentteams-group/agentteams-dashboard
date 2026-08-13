// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginApi } from '@/lib/plugins/api';
import { useExtensionStore } from '@/lib/plugins/extension-store';
import { pluginEventBus } from '@/lib/plugins/event-bus';
import { manifest } from './manifest';
import { activate, analyzeWorkers, buildChecks, buildReport, deactivate } from './index';
import type { WorkerResponse, TeamResponse, HumanResponse, InfrastructureInfo } from '@/lib/agentteams-api';

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
    const stateBefore = useExtensionStore.getState();
    expect(stateBefore.routes).toHaveLength(1);

    deactivate();

    const stateAfter = useExtensionStore.getState();
    expect(stateAfter.routes).toHaveLength(0);
    expect(stateAfter.menuItems).toHaveLength(0);
    expect(stateAfter.widgets).toHaveLength(0);
  });

  // ── analyzeWorkers ──────────────────────────────────────────────────

  describe('analyzeWorkers', () => {
    it('tallies phase distribution and reports failures', () => {
      const workers = [
        { name: 'a', phase: 'Running' },
        { name: 'b', phase: 'Pending' },
        { name: 'c', phase: 'Failed' },
        { name: 'd', phase: 'Failed' },
        { name: 'e', phase: 'Running' },
      ];
      const { distribution, failures } = analyzeWorkers(workers);
      expect(distribution).toEqual({ Running: 2, Pending: 1, Failed: 2 });
      expect(failures).toContain('c (Failed)');
      expect(failures).toContain('d (Failed)');
    });
  });

  // ── buildChecks ─────────────────────────────────────────────────────

  describe('buildChecks', () => {
    const makeWorker = (name: string, phase: WorkerResponse['phase']): WorkerResponse =>
      ({ name, phase, state: phase === 'Failed' ? 'Stopped' : 'Running', containerManaged: false, model: 'gpt-4', runtime: 'openclaw', image: '', containerState: '', matrixUserID: '', roomID: '', message: '', team: '', role: '' }) as WorkerResponse;
    const makeTeam = (name: string, phase: TeamResponse['phase']): TeamResponse =>
      ({ name, teamName: name, phase, description: '', admin: null, humanMembers: [], leaderName: '', leaderHeartbeat: null, workerIdleTimeout: '', teamRoomID: '', leaderDMRoomID: '', leaderReady: true, readyWorkers: 0, totalWorkers: 0, message: '', workerNames: [], workerExposedPorts: {} }) as TeamResponse;
    const makeHuman = (name: string, phase: HumanResponse['phase']): HumanResponse =>
      ({ name, phase, displayName: name, matrixUserID: '', initialPassword: '', rooms: [], message: '' }) as HumanResponse;

    const baseArgs = {
      cluster: { totalWorkers: 2, totalTeams: 1, totalHumans: 0, kubeMode: true },
      version: { controller: 'v1.2.0', dashboard: 'v1.2.0' },
      workers: [makeWorker('w1', 'Running'), makeWorker('w2', 'Running')],
      teams: [makeTeam('t1', 'Active')],
      humans: [] as HumanResponse[],
      infra: {
        minio: { healthy: true, endpoint: 'minio:9000', buckets: [] },
        higress: { mode: 'direct' as const, healthy: true, gateway: { configured: true, state: 'reachable' }, console: { configured: true, state: 'reachable' } },
        matrix: { healthy: true, homeserver: 'matrix.local' },
      } satisfies InfrastructureInfo,
    };

    it('flags a degraded cluster with failed workers', () => {
      const checks = buildChecks({
        ...baseArgs,
        workers: [makeWorker('w1', 'Failed'), makeWorker('w2', 'Failed')],
        infra: { minio: { healthy: false, endpoint: '', buckets: [] }, matrix: { healthy: true, homeserver: '' } satisfies NonNullable<InfrastructureInfo['matrix']> },
      } as any);
      const byId = Object.fromEntries(checks.map((c: any) => [c.id, c]));
      expect(byId['deployment-mode'].severity).toBe('ok');
      expect(byId['worker-phase'].severity).toBe('error');
      expect(byId['worker-phase'].detail).toContain('2 个 Failed');
      expect(byId['infra'].severity).toBe('warn');
      expect(byId['severity-rollup'].severity).toBe('error');
    });

    it('reports all-green on a healthy cluster', () => {
      const checks = buildChecks(baseArgs as any);
      const byId = Object.fromEntries(checks.map((c: any) => [c.id, c]));
      expect(byId['deployment-mode'].severity).toBe('ok');
      expect(byId['worker-phase'].severity).toBe('ok');
      expect(byId['infra'].severity).toBe('ok');
      expect(byId['severity-rollup'].severity).toBe('warn'); // totalHumans = 0
    });

    it('includes controller and dashboard version in detail', () => {
      const checks = buildChecks(baseArgs as any);
      const byId = Object.fromEntries(checks.map((c: any) => [c.id, c]));
      expect(byId['version-consistency'].severity).toBe('ok');
      expect(byId['version-consistency'].detail).toContain('v1.2.0');
    });

    it('shows message for failing workers', () => {
      const checks = buildChecks({
        ...baseArgs,
        workers: [makeWorker('w1', 'Failed'), makeWorker('w2', 'Failed')],
      } as any);
      const byId = Object.fromEntries(checks.map((c: any) => [c.id, c]));
      expect(byId['worker-phase'].severity).toBe('error');
      expect(byId['worker-phase'].detail).toContain('w1');
    });
  });

  // ── buildReport ─────────────────────────────────────────────────────

  describe('buildReport', () => {
    const makeWorker = (name: string, phase: WorkerResponse['phase']): WorkerResponse =>
      ({ name, phase, state: phase === 'Failed' ? 'Stopped' : 'Running', containerManaged: false, model: 'gpt-4', runtime: 'openclaw', image: '', containerState: '', matrixUserID: '', roomID: '', message: '', team: '', role: '' }) as WorkerResponse;
    const makeTeam = (name: string, phase: TeamResponse['phase']): TeamResponse =>
      ({ name, teamName: name, phase, description: '', admin: null, humanMembers: [], leaderName: '', leaderHeartbeat: null, workerIdleTimeout: '', teamRoomID: '', leaderDMRoomID: '', leaderReady: true, readyWorkers: 0, totalWorkers: 0, message: '', workerNames: [], workerExposedPorts: {} }) as TeamResponse;

    const baseArgs = {
      cluster: { totalWorkers: 2, totalTeams: 1, totalHumans: 0, kubeMode: true },
      version: { controller: 'v1.2.0', dashboard: 'v1.2.0' },
      workers: [makeWorker('w1', 'Running'), makeWorker('w2', 'Running')],
      teams: [makeTeam('t1', 'Active')],
      humans: [] as HumanResponse[],
      infra: {
        minio: { healthy: true, endpoint: 'minio:9000', buckets: [] },
        higress: { mode: 'direct' as const, healthy: true, gateway: { configured: true, state: 'reachable' }, console: { configured: true, state: 'reachable' } },
        matrix: { healthy: true, homeserver: 'matrix.local' },
      },
      checks: [] as import('./index').CheckResult[],
    };

    it('serializes a readable markdown report', () => {
      const checks = buildChecks(baseArgs as any);
      const report = buildReport({ ...baseArgs, checks } as any);
      expect(report).toContain('# 问天诊断报告');
      expect(report).toContain('Kubernetes');
      expect(report).toContain('v1.2.0');
      expect(report).toMatch(/生成时间：\d{4}-\d{2}-\d{2}T/);
    });
  });
});
