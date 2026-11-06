import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useExtensionStore } from '@/lib/plugins/extension-store';
import { Sidebar } from './sidebar';
import { MobileSidebar } from './mobile-sidebar';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import type { RoomInfo } from './sections/chat/room-info';

const labels = ['助手', '工作台', '资产中心', '成员与团队'];
const props = { activeSection: 'models', countMap: { 'my-workbench': 3 }, sectionsWithNotifications: new Set<string>(), onNavClick: vi.fn(), mode: 'embedded' as const };

beforeEach(() => {
  vi.clearAllMocks();
  useAgentTeamsStore.setState({ userLevel: 3, taskBoardVisible: true, classicNavigation: false, settingsOpen: false });
  useExtensionStore.getState().clear();
  useExtensionStore.getState().add('menuItems', 'monitor', { id: 'dashboard', label: '监控面板', target: { type: 'plugin-route', routeId: 'dashboard' } });
});
afterEach(cleanup);

describe('compact workspace navigation', () => {
  it('keeps exactly four desktop destinations and opens settings separately', () => {
    render(<TooltipProvider><Sidebar {...props} collapsed={false} onToggleCollapse={vi.fn()} /></TooltipProvider>);
    const nav = screen.getByRole('navigation', { name: '主要功能' });
    expect(within(nav).getAllByRole('button').map(button => button.textContent?.replace('3', ''))).toEqual(labels);
    expect(within(nav).getByRole('button', { name: '资产中心' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: '监控面板' })).toBeNull();
    fireEvent.click(within(nav).getByRole('button', { name: /工作台/ }));
    expect(props.onNavClick).toHaveBeenCalledWith('my-workbench');
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(useAgentTeamsStore.getState().settingsOpen).toBe(true);
  });

  it('keeps the same four destinations in the mobile drawer', () => {
    render(<MobileSidebar {...props} open onClose={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: '主要功能' });
    expect(within(nav).getAllByRole('button')).toHaveLength(4);
    for (const label of labels) expect(within(nav).getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    fireEvent.click(within(nav).getByRole('button', { name: '成员与团队' }));
    expect(props.onNavClick).toHaveBeenCalledWith('resources');
  });

  it('marks the parent menu for deep-linked work and asset pages when collapsed', () => {
    const view = render(<TooltipProvider><Sidebar {...props} activeSection="coding-runs" collapsed onToggleCollapse={vi.fn()} /></TooltipProvider>);
    expect(screen.getByRole('button', { name: '工作台' })).toHaveAttribute('aria-current', 'page');
    view.rerender(<TooltipProvider><Sidebar {...props} activeSection="knowledge" collapsed onToggleCollapse={vi.fn()} /></TooltipProvider>);
    expect(screen.getByRole('button', { name: '资产中心' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens the existing Leader DM from the assistant entry for a Team user', () => {
    useAgentTeamsStore.setState({ userLevel: 2 });
    useHitlInboxStore.setState({ pendingChatRoomId: null });
    const leader: RoomInfo = { id: '!leader:test', name: '设计团队助手', type: 'manager', agentRole: 'leader', members: [] };
    render(<Sidebar {...props} agentRooms={[leader]} collapsed={false} onToggleCollapse={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '助手' }));
    expect(props.onNavClick).toHaveBeenCalledWith('chat');
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe(leader.id);
  });
});
