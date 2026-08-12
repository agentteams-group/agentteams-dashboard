'use client';

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginRouteView } from './plugin-route-view';
import { useExtensionStore } from '@/lib/plugins/extension-store';
import { pluginSectionId, type RouteContribution } from '@/lib/plugins/types';

function makeRoute(id: string, title: string, text: string): RouteContribution {
  return { id, title, component: () => <div>{text}</div> };
}

describe('PluginRouteView', () => {
  beforeEach(() => {
    useExtensionStore.getState().clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the registered plugin page', () => {
    useExtensionStore.getState().add('routes', 'demo', makeRoute('home', 'Home', 'page body'));
    render(<PluginRouteView sectionId={pluginSectionId('demo', 'home')} />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('page body')).toBeInTheDocument();
  });

  it('shows a missing-page fallback for an invalid section id', () => {
    render(<PluginRouteView sectionId="not-a-plugin-section" />);
    expect(screen.getByText(/无效的插件页面地址/)).toBeInTheDocument();
  });

  it('shows a missing-page fallback when the route is not registered', () => {
    render(<PluginRouteView sectionId={pluginSectionId('ghost', 'nope')} />);
    expect(screen.getByText(/插件页面不存在或插件未启用/)).toBeInTheDocument();
  });

  it('isolates a crashing page behind the error boundary', () => {
    const bad: RouteContribution = {
      id: 'crash',
      title: 'Crash',
      component: () => {
        throw new Error('page exploded');
      },
    };
    useExtensionStore.getState().add('routes', 'demo', bad);
    render(<PluginRouteView sectionId={pluginSectionId('demo', 'crash')} />);
    expect(screen.getByText(/page exploded/)).toBeInTheDocument();
  });
});
