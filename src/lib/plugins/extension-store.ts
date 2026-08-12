'use client';

import { create } from 'zustand';
import type {
  DetailBlockContribution,
  ExtensionPointId,
  MenuItemContribution,
  RouteContribution,
  ToolbarButtonContribution,
  WidgetContribution,
} from './types';

/**
 * Central store of extension-point contributions.
 * Every record is tagged with the owning plugin id so a plugin can be
 * disabled/uninstalled atomically (removePlugin) without touching others.
 */

export interface ContributionRecord<T> {
  pluginId: string;
  contribution: T;
  registeredAt: number;
}

interface ExtensionState {
  menuItems: ContributionRecord<MenuItemContribution>[];
  routes: ContributionRecord<RouteContribution>[];
  widgets: ContributionRecord<WidgetContribution>[];
  detailBlocks: ContributionRecord<DetailBlockContribution>[];
  toolbarButtons: ContributionRecord<ToolbarButtonContribution>[];

  add: <T>(_point: PointListKey, _pluginId: string, _contribution: T) => void;
  removeFrom: (_point: PointListKey, _pluginId: string, _contributionId: string) => void;
  removePlugin: (_pluginId: string) => void;
  clear: () => void;
}

export type PointListKey = 'menuItems' | 'routes' | 'widgets' | 'detailBlocks' | 'toolbarButtons';

export const EXTENSION_POINT_TO_LIST: Record<ExtensionPointId, PointListKey> = {
  'sidebar-menu': 'menuItems',
  route: 'routes',
  'dashboard-widget': 'widgets',
  'detail-panel': 'detailBlocks',
  toolbar: 'toolbarButtons',
};

function upsert<T extends { id: string }>(
  list: ContributionRecord<T>[],
  pluginId: string,
  contribution: T,
  now: number
): ContributionRecord<T>[] {
  const without = list.filter(
    (r) => !(r.pluginId === pluginId && r.contribution.id === contribution.id)
  );
  return [...without, { pluginId, contribution, registeredAt: now }];
}

export const useExtensionStore = create<ExtensionState>()((set) => ({
  menuItems: [],
  routes: [],
  widgets: [],
  detailBlocks: [],
  toolbarButtons: [],

  add: (point, pluginId, contribution) => {
    const now = Date.now();
    set((state) => {
      const list = state[point] as ContributionRecord<{ id: string }>[];
      return {
        [point]: upsert(list, pluginId, contribution as { id: string }, now),
      } as Partial<ExtensionState>;
    });
  },

  removeFrom: (point, pluginId, contributionId) => {
    set((state) => ({
      [point]: (state[point] as ContributionRecord<{ id: string }>[]).filter(
        (r) => !(r.pluginId === pluginId && r.contribution.id === contributionId)
      ),
    }) as Partial<ExtensionState>);
  },

  removePlugin: (pluginId) => {
    set((state) => ({
      menuItems: state.menuItems.filter((r) => r.pluginId !== pluginId),
      routes: state.routes.filter((r) => r.pluginId !== pluginId),
      widgets: state.widgets.filter((r) => r.pluginId !== pluginId),
      detailBlocks: state.detailBlocks.filter((r) => r.pluginId !== pluginId),
      toolbarButtons: state.toolbarButtons.filter((r) => r.pluginId !== pluginId),
    }));
  },

  clear: () => {
    set(() => ({
      menuItems: [],
      routes: [],
      widgets: [],
      detailBlocks: [],
      toolbarButtons: [],
    }));
  },
}));

/** Deterministic ordering: explicit `order` first, then registration order. */
export function sortContributions<T>(records: ContributionRecord<T>[]): ContributionRecord<T>[] {
  return [...records].sort((a, b) => {
    const orderA = (a.contribution as { order?: number }).order ?? 0;
    const orderB = (b.contribution as { order?: number }).order ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    return a.registeredAt - b.registeredAt;
  });
}

// ── Selector hooks ──────────────────────────────────────────────

import { useMemo } from 'react';

function useSortedList<T>(list: ContributionRecord<T>[]): ContributionRecord<T>[] {
  // Every mutation rebuilds the arrays immutably, so the list reference alone
  // is a sufficient memo dependency.
  return useMemo(() => sortContributions(list), [list]);
}

export function usePluginMenuItems(): ContributionRecord<MenuItemContribution>[] {
  return useSortedList(useExtensionStore((s) => s.menuItems));
}

export function usePluginRoutes(): ContributionRecord<RouteContribution>[] {
  return useSortedList(useExtensionStore((s) => s.routes));
}

export function usePluginWidgets(): ContributionRecord<WidgetContribution>[] {
  return useSortedList(useExtensionStore((s) => s.widgets));
}

export function usePluginDetailBlocks(
  entity: DetailBlockContribution['entity']
): ContributionRecord<DetailBlockContribution>[] {
  const blocks = useExtensionStore((s) => s.detailBlocks);
  return useMemo(
    () => sortContributions(blocks.filter((r) => r.contribution.entity === entity)),
    [blocks, entity]
  );
}

export function usePluginToolbarButtons(): ContributionRecord<ToolbarButtonContribution>[] {
  return useSortedList(useExtensionStore((s) => s.toolbarButtons));
}
