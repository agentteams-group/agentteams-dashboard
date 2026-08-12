// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createPluginStore, pluginStorageKey, purgePluginState } from './sandbox';

describe('pluginStorageKey', () => {
  it('namespaces keys by plugin id', () => {
    expect(pluginStorageKey('alpha')).toBe('agentteams-plugin-state:alpha');
    expect(pluginStorageKey('beta')).toBe('agentteams-plugin-state:beta');
    expect(pluginStorageKey('alpha')).not.toBe(pluginStorageKey('beta'));
  });
});

describe('createPluginStore (isolation)', () => {
  it('returns an isolated store per plugin', () => {
    const storeA = createPluginStore('plugin-a', { count: 0 });
    const storeB = createPluginStore('plugin-b', { count: 100 });

    storeA.setState({ count: 1 });
    expect(storeA.getState().count).toBe(1);
    // B is unaffected by A's mutation.
    expect(storeB.getState().count).toBe(100);
  });

  it('two stores for the same plugin id are still distinct instances', () => {
    const s1 = createPluginStore('same', { v: 'one' });
    const s2 = createPluginStore('same', { v: 'two' });
    s1.setState({ v: 'changed' });
    expect(s1.getState().v).toBe('changed');
    expect(s2.getState().v).toBe('two');
  });

  it('supports subscribe notifications', () => {
    const store = createPluginStore('sub-plugin', { n: 0 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setState({ n: 5 });
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    store.setState({ n: 6 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('merges partial state on setState', () => {
    const store = createPluginStore('merge-plugin', { a: 1, b: 2 });
    store.setState({ a: 10 });
    expect(store.getState()).toEqual({ a: 10, b: 2 });
  });
});

describe('purgePluginState', () => {
  it('does not throw when storage is unavailable or key absent', () => {
    expect(() => purgePluginState('nonexistent')).not.toThrow();
  });
});
