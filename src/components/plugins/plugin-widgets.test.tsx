'use client';

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginWidgetsGrid } from './plugin-widgets';
import { useExtensionStore } from '@/lib/plugins/extension-store';
import { usePluginRegistry } from '@/lib/plugins/registry';
import type { WidgetContribution } from '@/lib/plugins/types';

function makeWidget(id: string, label: string): WidgetContribution {
  const component = () => <div>{label}</div>;
  return { id, title: label, component, size: 'md' };
}

const ThrowingWidget: WidgetContribution['component'] = () => {
  throw new Error('widget crashed');
};

describe('PluginWidgetsGrid', () => {
  beforeEach(() => {
    useExtensionStore.getState().clear();
    usePluginRegistry.setState({ records: {}, installedUrls: [], disabledIds: [], ready: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing when no widgets are registered', () => {
    const { container } = render(<PluginWidgetsGrid />);
    expect(container.querySelector('[data-testid="plugin-widgets"]')).toBeNull();
  });

  it('renders widgets from multiple plugins', () => {
    useExtensionStore.getState().add('widgets', 'plugin-a', makeWidget('w1', 'Widget One'));
    useExtensionStore.getState().add('widgets', 'plugin-b', makeWidget('w2', 'Widget Two'));

    render(<PluginWidgetsGrid />);

    expect(screen.getByText('Widget One')).toBeInTheDocument();
    expect(screen.getByText('Widget Two')).toBeInTheDocument();
  });

  it('isolates a crashing widget with the error boundary', () => {
    useExtensionStore.getState().add('widgets', 'good', makeWidget('ok', 'Healthy Widget'));
    useExtensionStore
      .getState()
      .add('widgets', 'bad', { id: 'bad-w', title: 'Bad', component: ThrowingWidget });

    render(<PluginWidgetsGrid />);

    // The healthy widget still renders; the bad one shows its error card.
    expect(screen.getByText('Healthy Widget')).toBeInTheDocument();
    expect(screen.getByText(/widget crashed/)).toBeInTheDocument();
  });
});
