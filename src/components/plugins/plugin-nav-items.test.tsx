'use client';

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginNavItems } from './plugin-nav-items';
import { useExtensionStore } from '@/lib/plugins/extension-store';
import { pluginSectionId, type MenuItemContribution } from '@/lib/plugins/types';

function makeItem(id: string, label: string): MenuItemContribution {
  return { id, label, icon: 'star', target: { type: 'plugin-route', routeId: id } };
}

describe('PluginNavItems', () => {
  beforeEach(() => {
    useExtensionStore.getState().clear();
  });
  afterEach(cleanup);

  it('renders nothing without menu contributions', () => {
    const { container } = render(
      <PluginNavItems activeSection="" collapsed={false} onNavClick={() => {}} />
    );
    expect(container.querySelector('[data-testid="plugin-nav-group"]')).toBeNull();
  });

  it('renders menu items from multiple plugins', () => {
    useExtensionStore.getState().add('menuItems', 'p1', makeItem('home', 'First Plugin'));
    useExtensionStore.getState().add('menuItems', 'p2', makeItem('dash', 'Second Plugin'));

    render(<PluginNavItems activeSection="" collapsed={false} onNavClick={() => {}} />);

    expect(screen.getByText('First Plugin')).toBeInTheDocument();
    expect(screen.getByText('Second Plugin')).toBeInTheDocument();
  });

  it('navigates to the plugin route section id on click', () => {
    useExtensionStore.getState().add('menuItems', 'p1', makeItem('home', 'My Page'));
    const onNavClick = vi.fn();

    render(<PluginNavItems activeSection="" collapsed={false} onNavClick={onNavClick} />);
    fireEvent.click(screen.getByText('My Page'));

    expect(onNavClick).toHaveBeenCalledWith(pluginSectionId('p1', 'home'));
  });

  it('marks the active plugin section', () => {
    useExtensionStore.getState().add('menuItems', 'p1', makeItem('home', 'My Page'));
    const active = pluginSectionId('p1', 'home');
    const { container } = render(
      <PluginNavItems activeSection={active} collapsed={false} onNavClick={() => {}} />
    );
    expect(container.querySelector('[data-plugin-menu-item="p1:home"]')).not.toBeNull();
  });
});
