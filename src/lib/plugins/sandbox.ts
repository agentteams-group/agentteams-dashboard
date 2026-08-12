import { createStore } from 'zustand/vanilla';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PluginStore } from './types';

/**
 * Per-plugin isolated state.
 *
 * Every call creates a brand-new vanilla zustand store instance — plugins
 * can never reach each other's stores or the host stores through this API.
 * Persisted state is namespaced by plugin id in localStorage.
 */

export function pluginStorageKey(pluginId: string): string {
  return `agentteams-plugin-state:${pluginId}`;
}

export function createPluginStore<
  TState extends Record<string, unknown> = Record<string, unknown>,
>(pluginId: string, initialState: TState): PluginStore<TState> {
  const vanilla = createStore<TState>()(
    persist(() => ({ ...initialState }), {
      name: pluginStorageKey(pluginId),
      storage: createJSONStorage(() => localStorage),
    })
  );

  return {
    getState: () => vanilla.getState(),
    setState: (partial: Partial<TState>) => vanilla.setState(partial),
    subscribe: (listener: () => void) => vanilla.subscribe(listener),
  };
}

/**
 * Removes a plugin's persisted state (called on uninstall).
 */
export function purgePluginState(pluginId: string): void {
  try {
    localStorage.removeItem(pluginStorageKey(pluginId));
  } catch {
    /* localStorage unavailable */
  }
}
