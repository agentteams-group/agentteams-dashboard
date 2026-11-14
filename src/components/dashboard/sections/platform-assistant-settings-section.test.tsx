import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagerResponse } from '@/lib/agentteams-api';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useSectionStore } from '@/lib/section-store';
import { PlatformAssistantSettingsSection } from './platform-assistant-settings-section';

const state = vi.hoisted(() => ({ managers: [] as ManagerResponse[], queried: vi.fn() }));
vi.mock('@/hooks/use-agentteams-managers', () => ({ useManagers: () => {
  state.queried();
  return { data: state.managers, refetch: vi.fn(), isLoading: false, isError: false };
} }));
vi.mock('@/hooks/use-model-selection', () => ({ useModelSelection: () => ({ options: [], sessionIssue: null }) }));
vi.mock('./managers/manager-detail-panel', () => ({ ManagerDetailPanel: ({ manager }: { manager: ManagerResponse }) => <div>settings:{manager.name}</div> }));
vi.mock('./managers-section', () => ({ ManagersSection: () => <div>instance-management</div> }));

beforeEach(() => {
  state.managers = [{ name: 'default', roomID: '!default:test' }] as ManagerResponse[];
  state.queried.mockClear();
  useAgentTeamsStore.setState({ userLevel: 3 });
  window.history.replaceState({}, '', '#workbench/assistant/settings');
});
afterEach(cleanup);

describe('platform assistant settings', () => {
  it('shows a single assistant without an instance selector and returns to its conversation', () => {
    render(<PlatformAssistantSettingsSection />);
    expect(screen.getByText('settings:default')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('高级管理').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: '返回对话' }));
    expect(useSectionStore.getState().activeSection).toBe('chat');
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!default:test');
  });
  it('selects a named instance from a deep link and follows browser navigation', () => {
    state.managers.push({ name: 'second', roomID: '!second:test' } as ManagerResponse);
    window.history.replaceState({}, '', '#workbench/assistant/settings?manager=second');
    render(<PlatformAssistantSettingsSection />);
    expect(screen.getByRole('combobox', { name: '助手实例' })).toHaveTextContent('second');
    expect(screen.getByText('settings:second')).toBeInTheDocument();
    window.history.replaceState({}, '', '#workbench/assistant/settings?manager=default');
    fireEvent(window, new Event('hashchange'));
    expect(screen.getByText('settings:default')).toBeInTheDocument();
  });
  it('does not silently edit another assistant when a bookmarked instance is missing', () => {
    window.history.replaceState({}, '', '#workbench/assistant/settings?manager=deleted');
    render(<PlatformAssistantSettingsSection />);
    expect(screen.getByRole('status')).toHaveTextContent('未找到该助手实例');
    expect(screen.queryByText('settings:default')).toBeNull();
  });
  it('keeps instance creation reachable when no assistant exists', () => {
    state.managers = [];
    render(<PlatformAssistantSettingsSection />);
    expect(screen.getByRole('status')).toHaveTextContent('尚未配置平台助手');
    fireEvent.click(screen.getByText('高级管理'));
    expect(screen.getByText('高级管理').closest('details')).toHaveAttribute('open');
    expect(screen.getByText('instance-management')).toBeVisible();
  });
  it('does not mount privileged settings or query Managers for Team users', () => {
    useAgentTeamsStore.setState({ userLevel: 2 });
    render(<PlatformAssistantSettingsSection />);
    expect(screen.getByText('仅管理员可以配置平台助手。')).toBeInTheDocument();
    expect(state.queried).not.toHaveBeenCalled();
    expect(screen.queryByText('高级管理')).toBeNull();
  });
});
