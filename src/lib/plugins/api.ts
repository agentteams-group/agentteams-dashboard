'use client';

import { toast } from 'sonner';
import { apiUrl } from '@/lib/api-base';
import { agentteamsApi } from '@/lib/agentteams-api';
import { useSectionStore } from '@/lib/section-store';
import { pluginEventBus } from './event-bus';
import { EXTENSION_POINT_TO_LIST, useExtensionStore } from './extension-store';
import { validateContributionId } from './manifest';
import { createPluginStore } from './sandbox';
import { EXTENSION_POINTS } from './types';
import type {
  AnyContribution,
  DashboardPluginApi,
  DetailBlockContribution,
  ExtensionPointId,
  MenuItemContribution,
  PluginManifest,
  PluginStore,
  RouteContribution,
  ToolbarButtonContribution,
  Unregister,
  WidgetContribution,
} from './types';

/**
 * Builds the scoped API object handed to a plugin's `activate()`.
 *
 * Every register* call is tracked so the host can force-cleanup all
 * contributions when a plugin is disabled/uninstalled, even if the plugin's
 * own deactivate() misbehaves.
 */

export const DASHBOARD_VERSION = '0.2.0';

export interface CreatePluginApiOptions {
  manifest: PluginManifest;
  /** Called with every unregister fn so the host can force-cleanup. */
  trackUnregister: (_unregister: Unregister) => void;
}

export function createPluginApi(options: CreatePluginApiOptions): DashboardPluginApi {
  const { manifest, trackUnregister } = options;
  const pluginId = manifest.id;
  const declaredPoints = manifest.extensionPoints;

  const assertPointAllowed = (point: ExtensionPointId) => {
    if (declaredPoints && !declaredPoints.includes(point)) {
      throw new Error(
        `插件 ${pluginId}: 清单未声明扩展点 "${point}"，请在 plugin.json 的 extensionPoints 中添加`
      );
    }
  };

  function register<T extends { id: string }>(
    point: ExtensionPointId,
    contribution: T
  ): Unregister {
    assertPointAllowed(point);
    validateContributionId(pluginId, contribution.id);
    const listKey = EXTENSION_POINT_TO_LIST[point];
    useExtensionStore.getState().add(listKey, pluginId, contribution);
    const unregister = () => {
      useExtensionStore.getState().removeFrom(listKey, pluginId, contribution.id);
    };
    trackUnregister(unregister);
    return unregister;
  }

  const events = {
    on: (event: string, handler: (_payload?: unknown) => void): Unregister => {
      pluginEventBus.on(event, handler);
      const off = () => pluginEventBus.off(event, handler);
      trackUnregister(off);
      return off;
    },
    off: (event: string, handler: (_payload?: unknown) => void) => {
      pluginEventBus.off(event, handler);
    },
    emit: (event: string, payload?: unknown) => {
      pluginEventBus.emit(event, payload);
    },
  };

  const http = {
    fetch: (path: string, init?: RequestInit) => fetch(apiUrl(path), init),
    get: async <T,>(path: string): Promise<T> => {
      const res = await fetch(apiUrl(path), { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`GET ${path} 失败: HTTP ${res.status}`);
      return (await res.json()) as T;
    },
    post: async <T,>(path: string, body?: unknown): Promise<T> => {
      const res = await fetch(apiUrl(path), {
        method: 'POST',
        credentials: 'same-origin',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`POST ${path} 失败: HTTP ${res.status}`);
      return (await res.json()) as T;
    },
  };

  const dashboard = {
    navigate: (sectionId: string) => {
      useSectionStore.getState().setActiveSection(sectionId);
    },
    toast: (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
      if (type === 'success') toast.success(message);
      else if (type === 'warning') toast.warning(message);
      else if (type === 'error') toast.error(message);
      else toast.info(message);
    },
    getClusterStatus: () => agentteamsApi.getStatus(),
    getVersion: () => agentteamsApi.getVersion(),
    listWorkers: () => agentteamsApi.listWorkers(),
    listTeams: () => agentteamsApi.listTeams(),
    listManagers: () => agentteamsApi.listManagers(),
    listHumans: () => agentteamsApi.listHumans(),
  };

  const log = {
    // no-console allows warn/error only; info is surfaced through warn.
    info: (...args: unknown[]) => console.warn(`[plugin:${pluginId}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[plugin:${pluginId}]`, ...args),
    error: (...args: unknown[]) => console.error(`[plugin:${pluginId}]`, ...args),
  };

  const api: DashboardPluginApi = {
    pluginId,
    dashboardVersion: DASHBOARD_VERSION,
    pluginApiVersion: 1,

    registerMenuItem: (item: MenuItemContribution) => register('sidebar-menu', item),
    registerRoute: (route: RouteContribution) => register('route', route),
    registerWidget: (widget: WidgetContribution) => register('dashboard-widget', widget),
    registerDetailBlock: (block: DetailBlockContribution) => register('detail-panel', block),
    registerToolbarButton: (button: ToolbarButtonContribution) => register('toolbar', button),
    registerComponent: (point: ExtensionPointId, contribution: AnyContribution) => {
      if (!EXTENSION_POINTS.includes(point)) {
        throw new Error(`插件 ${pluginId}: 未知扩展点 "${String(point)}"`);
      }
      return register(point, contribution);
    },

    events,
    store: createPluginStore(pluginId, {}) as PluginStore,
    http,
    dashboard,
    log,
  };

  return api;
}
