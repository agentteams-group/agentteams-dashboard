// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginApi, DASHBOARD_VERSION } from './api';
import { useExtensionStore } from './extension-store';
import { pluginEventBus } from './event-bus';
import { useSectionStore } from '@/lib/section-store';
import { toast } from 'sonner';
import type { PluginManifest } from './types';

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    entry: { dashboard: 'index.js' },
    ...overrides,
  };
}

function makeApi(manifestOverrides: Partial<PluginManifest> = {}) {
  const tracked: Array<() => void> = [];
  const api = createPluginApi({
    manifest: manifest(manifestOverrides),
    trackUnregister: (fn) => tracked.push(fn),
  });
  return { api, tracked };
}

describe('createPluginApi', () => {
  beforeEach(() => {
    useExtensionStore.getState().clear();
    pluginEventBus.clear();
  });

  it('exposes identity fields', () => {
    const { api } = makeApi();
    expect(api.pluginId).toBe('test-plugin');
    expect(api.dashboardVersion).toBe(DASHBOARD_VERSION);
    expect(api.pluginApiVersion).toBe(1);
  });

  it('registerMenuItem adds a sidebar contribution and unregister removes it', () => {
    const { api } = makeApi();
    const unregister = api.registerMenuItem({
      id: 'home',
      label: 'Home',
      icon: 'home',
      target: { type: 'section', sectionId: 'overview' },
    });
    expect(useExtensionStore.getState().menuItems).toHaveLength(1);
    unregister();
    expect(useExtensionStore.getState().menuItems).toHaveLength(0);
  });

  it('registers widgets, routes, detail blocks and toolbar buttons', () => {
    const { api } = makeApi({ extensionPoints: ['dashboard-widget', 'route', 'detail-panel', 'toolbar'] });
    const noop = (() => null) as unknown as () => null;
    api.registerWidget({ id: 'w', title: 'W', component: noop });
    api.registerRoute({ id: 'r', title: 'R', component: noop });
    api.registerDetailBlock({ id: 'd', entity: 'worker', component: noop as never });
    api.registerToolbarButton({ id: 't', label: 'T' });

    const state = useExtensionStore.getState();
    expect(state.widgets).toHaveLength(1);
    expect(state.routes).toHaveLength(1);
    expect(state.detailBlocks).toHaveLength(1);
    expect(state.toolbarButtons).toHaveLength(1);
  });

  it('enforces declared extensionPoints', () => {
    const { api } = makeApi({ extensionPoints: ['sidebar-menu'] });
    expect(() =>
      api.registerWidget({ id: 'w', title: 'W', component: (() => null) as never })
    ).toThrow(/extensionPoints/);
  });

  it('allows all points when extensionPoints is not declared', () => {
    const { api } = makeApi(); // no extensionPoints field
    expect(() =>
      api.registerWidget({ id: 'w', title: 'W', component: (() => null) as never })
    ).not.toThrow();
  });

  it('registerComponent dispatches by point id', () => {
    const { api } = makeApi();
    api.registerComponent('sidebar-menu', {
      id: 'via-generic',
      label: 'Generic',
      target: { type: 'section', sectionId: 'overview' },
    });
    expect(useExtensionStore.getState().menuItems).toHaveLength(1);
    expect(() => api.registerComponent('not-a-point' as never, { id: 'x' } as never)).toThrow();
  });

  it('rejects invalid contribution ids', () => {
    const { api } = makeApi();
    expect(() =>
      api.registerMenuItem({ id: 'bad id', label: 'x', target: { type: 'section', sectionId: 'o' } })
    ).toThrow();
  });

  it('events bridge onto the shared bus', () => {
    const { api } = makeApi();
    const received = vi.fn();
    api.events.on('topic', received);
    api.events.emit('topic', { hello: true });
    expect(received).toHaveBeenCalledWith({ hello: true });
  });

  it('provides an isolated store and logger', () => {
    const { api } = makeApi();
    api.store.setState({ foo: 'bar' });
    expect(api.store.getState().foo).toBe('bar');
    expect(() => api.log.info('hello')).not.toThrow();
    expect(() => api.log.error('oops')).not.toThrow();
  });

  it('trackUnregister receives every registration cleanup', () => {
    const { api, tracked } = makeApi();
    api.registerMenuItem({ id: 'm', label: 'M', target: { type: 'section', sectionId: 'o' } });
    api.events.on('e', () => {});
    // 1 menu item + 1 event listener tracked
    expect(tracked.length).toBe(2);
    for (const fn of tracked) fn();
    expect(useExtensionStore.getState().menuItems).toHaveLength(0);
  });

  it('events.off removes a handler', () => {
    const { api } = makeApi();
    const received = vi.fn();
    api.events.on('t2', received);
    api.events.off('t2', received);
    api.events.emit('t2');
    expect(received).not.toHaveBeenCalled();
  });
});

describe('createPluginApi http + dashboard services', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('http.get parses JSON on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    );
    const { api } = makeApi();
    await expect(api.http.get('/api/x')).resolves.toEqual({ ok: true });
  });

  it('http.get throws on non-OK', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    const { api } = makeApi();
    await expect(api.http.get('/api/x')).rejects.toThrow(/500/);
  });

  it('http.post sends a JSON body and parses the response', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ id: 1 }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { api } = makeApi();
    await expect(api.http.post('/api/x', { a: 1 })).resolves.toEqual({ id: 1 });
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('http.fetch returns the raw Response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('raw', { status: 200 })));
    const { api } = makeApi();
    const res = await api.http.fetch('/api/x');
    expect(res.status).toBe(200);
  });

  it('dashboard.navigate updates the section store', () => {
    const { api } = makeApi();
    api.dashboard.navigate('workers');
    expect(useSectionStore.getState().activeSection).toBe('workers');
  });

  it('dashboard.toast routes to the matching sonner method', () => {
    const { api } = makeApi();
    api.dashboard.toast('yay', 'success');
    api.dashboard.toast('warn', 'warning');
    api.dashboard.toast('bad', 'error');
    api.dashboard.toast('fyi');
    expect(toast.success).toHaveBeenCalledWith('yay');
    expect(toast.warning).toHaveBeenCalledWith('warn');
    expect(toast.error).toHaveBeenCalledWith('bad');
    expect(toast.info).toHaveBeenCalledWith('fyi');
  });
});
