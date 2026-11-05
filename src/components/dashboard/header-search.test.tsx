import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DashboardHeader } from './header';
import { MobileQuickBar } from './mobile-quick-bar';

vi.mock('@/components/theme/theme-provider', () => ({ useTheme: () => ({ resolvedTheme: { id: 'light', base: 'light' }, setTheme: vi.fn(), locked: false }) }));
vi.mock('./notification-popover', () => ({ NotificationPopover: () => null }));
vi.mock('@/components/plugins/plugin-toolbar-buttons', () => ({ PluginToolbarButtons: () => null }));
vi.mock('./command-palette', () => ({ useGlobalSearch: () => [], CommandPalette: () => null }));

afterEach(cleanup);

it('opens the shared search field from the mobile bar and forwards the query', async () => {
  const searchRef = createRef<HTMLInputElement>();
  const onSearchChange = vi.fn();
  render(<TooltipProvider>
    <DashboardHeader isConnected workerCount={0} teamCount={0} managerCount={0} versionString={undefined} isRefreshingAll={false} searchQuery="" searchInputRef={searchRef} onSearchChange={onSearchChange} onNavClick={vi.fn()} onRefreshAll={vi.fn()} onOpenMobileMenu={vi.fn()} onOpenSettings={vi.fn()} />
    <MobileQuickBar onSearch={() => searchRef.current?.focus()} />
  </TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  const input = screen.getByRole('textbox', { name: '搜索工作区' });
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: '团队' } });
  await waitFor(() => expect(onSearchChange).toHaveBeenLastCalledWith('团队'));
});
