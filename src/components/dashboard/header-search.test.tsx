import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DashboardHeader } from './header';
import { MobileQuickBar } from './mobile-quick-bar';

vi.mock('@/components/theme/theme-provider', () => ({ useTheme: () => ({ resolvedTheme: { id: 'light', base: 'light' }, setTheme: vi.fn(), locked: false }) }));
vi.mock('@/hooks/use-assistant-task-feed', () => ({ useAssistantTaskFeed: () => ({ workflows: [], loading: false, degraded: false, partialError: false }) }));
vi.mock('./notification-popover', () => ({ NotificationPopover: () => null }));
vi.mock('./connection-status', () => ({ ConnectionStatus: () => null }));
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
  expect(screen.queryByRole('group', { name: '资源数量' })).toBeNull();
  expect(screen.queryByRole('group', { name: '工作状态' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  const input = screen.getByRole('textbox', { name: '搜索工作区' });
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: '团队' } });
  await waitFor(() => expect(onSearchChange).toHaveBeenLastCalledWith('团队'));
});

it('shows search guidance and an empty result instead of silently doing nothing', () => {
  render(<TooltipProvider><DashboardHeader isConnected workerCount={0} teamCount={0} managerCount={0} versionString={undefined} isRefreshingAll={false} searchQuery="" onSearchChange={vi.fn()} onNavClick={vi.fn()} onRefreshAll={vi.fn()} onOpenMobileMenu={vi.fn()} onOpenSettings={vi.fn()} /></TooltipProvider>);
  const input = screen.getByRole('textbox', { name: '搜索工作区' });
  fireEvent.focus(input);
  expect(screen.getByText('输入名称搜索智能体、任务或页面')).toBeVisible();
  fireEvent.change(input, { target: { value: '不存在的任务' } });
  expect(screen.getByText('没有找到匹配结果')).toBeVisible();
});
