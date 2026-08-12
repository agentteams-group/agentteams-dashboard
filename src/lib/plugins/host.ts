'use client';

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { pluginEventBus } from './event-bus';
import { DASHBOARD_VERSION } from './api';

/**
 * Global host bridge for URL-loaded plugin bundles.
 *
 * Plugins built with the `create-dashboard-plugin` scaffold alias `react`
 * and `react/jsx-runtime` to a tiny shim that reads this object, so their
 * bundle shares the host's React instance (required for hooks/context).
 */

export const HOST_GLOBAL_KEY = '__AGENTTEAMS_DASHBOARD_HOST__';

export interface DashboardPluginHost {
  version: string;
  pluginApiVersion: number;
  React: typeof React;
  ReactDOM: typeof ReactDOM;
  events: {
    on: (_event: string, _handler: (_payload?: unknown) => void) => void;
    off: (_event: string, _handler: (_payload?: unknown) => void) => void;
    emit: (_event: string, _payload?: unknown) => void;
  };
}

export function installPluginHost(): void {
  if (typeof window === 'undefined') return;
  const target = window as unknown as Record<string, unknown>;
  if (target[HOST_GLOBAL_KEY]) return;
  const host: DashboardPluginHost = {
    version: DASHBOARD_VERSION,
    pluginApiVersion: 1,
    React,
    ReactDOM,
    events: {
      on: (event, handler) => pluginEventBus.on(event, handler),
      off: (event, handler) => pluginEventBus.off(event, handler),
      emit: (event, payload) => pluginEventBus.emit(event, payload),
    },
  };
  target[HOST_GLOBAL_KEY] = host;
}

export function getPluginHost(): DashboardPluginHost | null {
  if (typeof window === 'undefined') return null;
  const target = window as unknown as Record<string, unknown>;
  return (target[HOST_GLOBAL_KEY] as DashboardPluginHost) ?? null;
}
