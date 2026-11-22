import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

const store = {
  controllerUrl: '',
  setControllerUrl: vi.fn(),
  isConnected: true,
  isChecking: false,
  connectionError: null,
  settingsOpen: true,
  closeSettings: vi.fn(),
  autoReconnect: false,
  setAutoReconnect: vi.fn(),
  reconnectInterval: 5000,
  setReconnectInterval: vi.fn(),
  connectionLatency: 10,
  lastConnectedAt: null,
  connectionHistory: [],
  taskBoardVisible: true,
  setTaskBoardVisible: vi.fn(),
  userLevel: 3,
  replyEnterAction: 'send',
  setReplyEnterAction: vi.fn(),
};

vi.mock('@/lib/agentteams-store', () => ({
  useAgentTeamsStore: (selector?: (_state: typeof store) => unknown) =>
    selector ? selector(store) : store,
}));

vi.mock('@/hooks/use-agentteams-infrastructure', () => ({
  useInfrastructure: () => ({ data: null }),
}));

const matrixState = { isLoggedIn: true, userId: '@alice:test', logout: vi.fn() };
vi.mock('@/lib/matrix-store', () => ({
  useMatrixStore: (selector: (_state: typeof matrixState) => unknown) => selector(matrixState),
}));

vi.mock('./settings/theme-tab', () => ({ ThemeTab: () => <div>theme-tab</div> }));
vi.mock('./settings/plugins-tab', () => ({ PluginsTab: () => <div>plugins-tab</div> }));
vi.mock('./settings/backend-tab', () => ({ BackendTab: () => <div>backend-tab</div> }));
vi.mock('./settings/speech-settings', () => ({ SpeechSettings: () => <div>speech</div> }));
vi.mock('./settings/client-config-tab', () => ({ ClientConfigTab: () => <div>client-tab</div> }));
vi.mock('./settings/update-tab', () => ({ UpdateTab: () => <div>update-tab</div> }));
vi.mock('./settings/management-tab', () => ({
  ManagementTab: () => <div>management-tab</div>,
  navigateFromSettings: vi.fn(),
}));
vi.mock('./sections/plugins/plugin-gallery', () => ({
  PluginGallery: () => <div>plugin-gallery</div>,
}));

import { SettingsDialog } from './settings-dialog';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authMode: 'session' }),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SettingsDialog · 模块更新已迁出', () => {
  it('设置里不再有「模块」tab / 模块更新入口', () => {
    render(<SettingsDialog />);
    expect(screen.getByText('设置')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '模块' })).toBeNull();
    expect(screen.queryByText('模块更新')).toBeNull();
    expect(screen.queryByTestId('modules-tab')).toBeNull();
  });

  it('保留既有 tab 集合', () => {
    render(<SettingsDialog />);
    for (const name of ['管理', '连接', '聊天', '后端', '外观', 'Beta功能', '插件', '更新']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
  });

  it('exposes the reply Enter preference under chat settings', () => {
    render(<SettingsDialog />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: '聊天' }), { button: 0, ctrlKey: false });
    expect(screen.getByRole('combobox', { name: '回复中按 Enter' })).toHaveTextContent('立即发送');
  });

  it('keeps chat capability and disconnect controls in connection settings', () => {
    render(<SettingsDialog />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: '连接' }), { button: 0, ctrlKey: false });
    expect(screen.getByRole('region', { name: '聊天连接诊断' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /服务端能力/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '断开对话连接' }));
    expect(matrixState.logout).toHaveBeenCalledOnce();
  });
});
