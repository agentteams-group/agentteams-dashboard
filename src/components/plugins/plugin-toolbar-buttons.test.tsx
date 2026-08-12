'use client';

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginToolbarButtons } from './plugin-toolbar-buttons';
import { useExtensionStore } from '@/lib/plugins/extension-store';
import type { ToolbarButtonContribution } from '@/lib/plugins/types';

describe('PluginToolbarButtons', () => {
  beforeEach(() => {
    useExtensionStore.getState().clear();
  });
  afterEach(cleanup);

  it('renders nothing when no toolbar buttons are registered', () => {
    const { container } = render(<PluginToolbarButtons />);
    expect(container.querySelector('[data-testid="plugin-toolbar"]')).toBeNull();
  });

  it('renders an icon button and fires onClick', () => {
    const onClick = vi.fn();
    const button: ToolbarButtonContribution = { id: 'ping', label: 'Ping', icon: 'zap', onClick };
    useExtensionStore.getState().add('toolbarButtons', 'demo', button);

    render(<PluginToolbarButtons />);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a custom component when provided', () => {
    const button: ToolbarButtonContribution = {
      id: 'custom',
      label: 'Custom',
      component: () => <div>custom toolbar node</div>,
    };
    useExtensionStore.getState().add('toolbarButtons', 'demo', button);

    render(<PluginToolbarButtons />);
    expect(screen.getByText('custom toolbar node')).toBeInTheDocument();
  });
});
