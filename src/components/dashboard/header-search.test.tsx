import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DashboardHeader } from './header';
import { MobileQuickBar } from './mobile-quick-bar';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';

vi.mock('@/components/theme/theme-provider', () => ({ useTheme: () => ({ resolvedTheme: { id: 'light', base: 'light' }, setTheme: vi.fn(), locked: false }) }));
vi.mock('@/hooks/use-assistant-task-feed', () => ({ useAssistantTaskFeed: () => ({ workflows: [], loading: false, degraded: false, partialError: false }) }));
vi.mock('./notification-popover', () => ({ NotificationPopover: () => null }));
vi.mock('./connection-status', () => ({ ConnectionStatus: () => null }));
vi.mock('@/components/plugins/plugin-toolbar-buttons', () => ({ PluginToolbarButtons: () => null }));
vi.mock('./command-palette', async importOriginal => ({
  ...(await importOriginal<typeof import('./command-palette')>()),
  useGlobalSearch: (query: string) => query ? [] : [
    { entity: 'section', name: '首页', section: 'overview', subtitle: '', phase: '' },
    { entity: 'section', name: '任务看板', section: 'tasks', subtitle: '', phase: '' },
  ],
}));

afterEach(cleanup);

it('does not redirect or clear Matrix credentials when logout returns 500, and supports retry', async () => {
  const replace = vi.fn();
  const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location')!;
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, replace } });
  useAgentTeamsStore.setState({ sessionUser: 'admin', userLevel: 3 });
  useMatrixStore.setState({ accessToken: 'keep-me', userId: '@admin:test' });
  const matrixLogout = vi.spyOn(useMatrixStore.getState(), 'logout');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
  try {
    render(<TooltipProvider><DashboardHeader isConnected workerCount={0} teamCount={0} managerCount={0} versionString={undefined} isRefreshingAll={false} searchQuery="" onSearchChange={vi.fn()} onNavClick={vi.fn()} onRefreshAll={vi.fn()} onOpenMobileMenu={vi.fn()} onOpenSettings={vi.fn()} /></TooltipProvider>);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'admin' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: '退出登录' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 500');
    expect(replace).not.toHaveBeenCalled();
    expect(matrixLogout).not.toHaveBeenCalled();
    expect(useMatrixStore.getState().accessToken).toBe('keep-me');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1));
  } finally {
    Object.defineProperty(window, 'location', locationDescriptor);
    vi.unstubAllGlobals();
    matrixLogout.mockRestore();
    useAgentTeamsStore.setState({ sessionUser: null });
  }
});

it('redirects and clears Matrix credentials only after a 2xx logout', async () => {
  const replace = vi.fn();
  const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location')!;
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, replace } });
  useAgentTeamsStore.setState({ sessionUser: 'admin', userLevel: 3 });
  useMatrixStore.setState({ accessToken: 'clear-me', userId: '@admin:test' });
  const matrixLogout = vi.spyOn(useMatrixStore.getState(), 'logout');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  try {
    render(<TooltipProvider><DashboardHeader isConnected workerCount={0} teamCount={0} managerCount={0} versionString={undefined} isRefreshingAll={false} searchQuery="" onSearchChange={vi.fn()} onNavClick={vi.fn()} onRefreshAll={vi.fn()} onOpenMobileMenu={vi.fn()} onOpenSettings={vi.fn()} /></TooltipProvider>);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'admin' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: '退出登录' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(matrixLogout).toHaveBeenCalledOnce();
    expect(useMatrixStore.getState().accessToken).toBe('');
  } finally {
    Object.defineProperty(window, 'location', locationDescriptor);
    vi.unstubAllGlobals();
    matrixLogout.mockRestore();
    useAgentTeamsStore.setState({ sessionUser: null });
  }
});

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

it('shows shortcuts on focus, an empty result after typing, and restores shortcuts on clear', async () => {
  render(<TooltipProvider><DashboardHeader isConnected workerCount={0} teamCount={0} managerCount={0} versionString={undefined} isRefreshingAll={false} searchQuery="" onSearchChange={vi.fn()} onNavClick={vi.fn()} onRefreshAll={vi.fn()} onOpenMobileMenu={vi.fn()} onOpenSettings={vi.fn()} /></TooltipProvider>);
  const input = screen.getByRole('textbox', { name: '搜索工作区' });
  fireEvent.focus(input);
  expect(screen.getByRole('region', { name: '常用页面' })).toBeVisible();
  expect(screen.getByRole('button', { name: '任务看板' })).toBeVisible();
  fireEvent.change(input, { target: { value: '不存在的任务' } });
  expect(await screen.findByText('没有找到匹配结果')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
  expect(input).toHaveValue('');
  expect(input).toHaveFocus();
  expect(screen.getByRole('region', { name: '常用页面' })).toBeVisible();
});

it('opens the current search field with the global shortcut and closes it with Escape', () => {
  render(<TooltipProvider><DashboardHeader isConnected workerCount={0} teamCount={0} managerCount={0} versionString={undefined} isRefreshingAll={false} searchQuery="" onSearchChange={vi.fn()} onNavClick={vi.fn()} onRefreshAll={vi.fn()} onOpenMobileMenu={vi.fn()} onOpenSettings={vi.fn()} /></TooltipProvider>);
  const input = screen.getByRole('textbox', { name: '搜索工作区' });
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  expect(input).toHaveFocus();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(input).not.toHaveFocus();
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  expect(input).toHaveFocus();
});

it('keeps search open through the results and closes after the mouse leaves both', () => {
  render(<TooltipProvider><DashboardHeader isConnected workerCount={0} teamCount={0} managerCount={0} versionString={undefined} isRefreshingAll={false} searchQuery="" onSearchChange={vi.fn()} onNavClick={vi.fn()} onRefreshAll={vi.fn()} onOpenMobileMenu={vi.fn()} onOpenSettings={vi.fn()} /></TooltipProvider>);
  const input = screen.getByRole('textbox', { name: '搜索工作区' });
  fireEvent.click(input);
  const result = screen.getByRole('button', { name: '任务看板' });
  const moveFrom = (from: Element, to: Element) => {
    const event = new MouseEvent('pointerout', { bubbles: true, relatedTarget: to });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    fireEvent(from, event);
  };
  moveFrom(input, result);
  expect(result).toBeVisible();
  moveFrom(result, screen.getByRole('navigation', { name: '面包屑' }));
  expect(screen.queryByRole('region', { name: '常用页面' })).toBeNull();
});
