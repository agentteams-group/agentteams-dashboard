'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PluginManifest, PluginRecord, PluginSource, PluginStatus } from './types';

/**
 * Plugin registry: source of truth for which plugins exist, their load
 * status and the user's enable/disable choices.
 *
 * Persisted bits: the installed `url` plugin manifest URLs and the ids the
 * user disabled. Bundled plugins are always rediscovered on boot; url
 * plugins are reinstalled from their persisted manifest URLs.
 */

export const PLUGIN_REGISTRY_STORAGE_KEY = 'agentteams-plugins';

export interface PluginRegistryState {
  records: Record<string, PluginRecord>;
  installedUrls: string[];
  disabledIds: string[];
  /** True once initial discovery finished (used by the shell guard). */
  ready: boolean;

  upsertRecord: (_record: PluginRecord) => void;
  updateStatus: (_id: string, _status: PluginStatus, _error?: string) => void;
  removeRecord: (_id: string) => void;
  addInstalledUrl: (_url: string) => void;
  removeInstalledUrl: (_url: string) => void;
  setDisabled: (_id: string, _disabled: boolean) => void;
  setReady: (_ready: boolean) => void;
}

export const usePluginRegistry = create<PluginRegistryState>()(
  persist(
    (set) => ({
      records: {},
      installedUrls: [],
      disabledIds: [],
      ready: false,

      upsertRecord: (record: PluginRecord) => {
        set((state) => ({
          records: { ...state.records, [record.manifest.id]: record },
        }));
      },

      updateStatus: (id: string, status: PluginStatus, error?: string) => {
        set((state) => {
          const existing = state.records[id];
          if (!existing) return state;
          return {
            records: {
              ...state.records,
              [id]: { ...existing, status, error: error ?? undefined },
            },
          };
        });
      },

      removeRecord: (id: string) => {
        set((state) => {
          const records = { ...state.records };
          delete records[id];
          const disabledIds = state.disabledIds.filter((x) => x !== id);
          return { records, disabledIds };
        });
      },

      addInstalledUrl: (url: string) => {
        set((state) =>
          state.installedUrls.includes(url)
            ? state
            : { installedUrls: [...state.installedUrls, url] }
        );
      },

      removeInstalledUrl: (url: string) => {
        set((state) => ({
          installedUrls: state.installedUrls.filter((u) => u !== url),
        }));
      },

      setDisabled: (id: string, disabled: boolean) => {
        set((state) => {
          const has = state.disabledIds.includes(id);
          if (disabled === has) return state;
          return {
            disabledIds: disabled
              ? [...state.disabledIds, id]
              : state.disabledIds.filter((x) => x !== id),
          };
        });
      },

      setReady: (ready: boolean) => set({ ready }),
    }),
    {
      name: PLUGIN_REGISTRY_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        installedUrls: state.installedUrls,
        disabledIds: state.disabledIds,
      }),
    }
  )
);

export function makePluginRecord(
  manifest: PluginManifest,
  source: PluginSource,
  status: PluginStatus = 'installed'
): PluginRecord {
  return { manifest, source, status, installedAt: Date.now() };
}

export function selectPluginList(state: Pick<PluginRegistryState, 'records'>): PluginRecord[] {
  return Object.values(state.records).sort((a, b) =>
    a.manifest.id.localeCompare(b.manifest.id)
  );
}

export function isPluginDisabled(state: Pick<PluginRegistryState, 'disabledIds'>, id: string): boolean {
  return state.disabledIds.includes(id);
}
