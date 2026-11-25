import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ApiError } from '@/lib/api-error';
import { WorkerQwenCodeBridgeCard } from './worker-qwen-code-bridge-card';

const api = vi.hoisted(() => ({
  getMillforgeIndex: vi.fn(),
  getWorkerPlugins: vi.fn(),
  installWorkerPlugin: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/agentteams-api', () => ({ agentteamsApi: api }));
vi.mock('sonner', () => ({ toast: toastMock }));

const BRIDGE_ZIP = 'qwenpaw-qwencode-bridge-0.3.0.zip';

function indexOf(latest: string | null, versions: Record<string, unknown>) {
  return {
    schema: 1,
    channel: 'stable',
    modules: {
      'qwenpaw-qwencode-bridge': { kind: 'plugin', pluginId: 'qwen-code-bridge', latest, versions },
    },
    source: 'github',
    repo: 'LUOSENGWA/Millforge',
    fetched_at: '2026-11-08T01:30:00Z',
  };
}

const STABLE_INDEX = indexOf('0.3.0', {
  '0.3.0': { artifacts: [{ name: BRIDGE_ZIP, sha256: 'sha-0.3.0' }] },
  '0.2.0': {
    artifacts: [{ name: 'qwenpaw-qwencode-bridge-0.2.0.zip', sha256: 'sha-0.2.0' }],
  },
});

const EMPTY_INDEX = indexOf(null, {});

describe('WorkerQwenCodeBridgeCard（QwenPaw × QwenCode 桥）', () => {
  beforeEach(() => {
    api.getMillforgeIndex.mockReset().mockResolvedValue(STABLE_INDEX);
    api.getWorkerPlugins.mockReset().mockResolvedValue([]);
    api.installWorkerPlugin.mockReset().mockResolvedValue({ installed: true, loaded: true });
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('非 qwenpaw 运行时整段不渲染，也不发索引/插件请求', () => {
    const { container } = render(
      <WorkerQwenCodeBridgeCard workerName="w1" runtime="openclaw" />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(api.getMillforgeIndex).not.toHaveBeenCalled();
    expect(api.getWorkerPlugins).not.toHaveBeenCalled();
  });

  it('未装：按 stable 拉索引，展示未装并安装默认最新版本', async () => {
    const onChanged = vi.fn();
    render(
      <WorkerQwenCodeBridgeCard workerName="w1" runtime="qwenpaw" onChanged={onChanged} />,
    );

    expect(await screen.findByText('未装')).toBeInTheDocument();
    expect(api.getMillforgeIndex).toHaveBeenCalledWith({
      source: 'github',
      repo: 'LUOSENGWA/Millforge',
      ref: 'main',
      channel: 'stable',
    });
    expect(api.getWorkerPlugins).toHaveBeenCalledWith('w1');

    fireEvent.click(screen.getByRole('button', { name: /安装 0\.3\.0/ }));

    await waitFor(() =>
      expect(api.installWorkerPlugin).toHaveBeenCalledWith('w1', {
        module: 'qwenpaw-qwencode-bridge',
        source: 'github',
        repo: 'LUOSENGWA/Millforge',
        ref: 'main',
        channel: 'stable',
        version: '0.3.0',
        artifact: BRIDGE_ZIP,
        sha256: 'sha-0.3.0',
      }),
    );
    expect(toastMock.success).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText('已是最新')).toBeInTheDocument();
  });

  it('已装且与索引一致：显示已是最新，不出安装按钮', async () => {
    api.getWorkerPlugins.mockResolvedValue([{ id: 'qwen-code-bridge', version: '0.3.0' }]);
    render(<WorkerQwenCodeBridgeCard workerName="w1" runtime="qwenpaw" />);

    expect(await screen.findByText('已是最新')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /安装/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /更新/ })).not.toBeInTheDocument();
  });

  it('已装低于索引最新：显示可更新，按钮为更新', async () => {
    api.getWorkerPlugins.mockResolvedValue([{ id: 'qwen-code-bridge', version: '0.2.0' }]);
    render(<WorkerQwenCodeBridgeCard workerName="w1" runtime="qwenpaw" />);

    expect(await screen.findByText('可更新')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /更新 0\.3\.0/ })).toBeInTheDocument();
  });

  it('该频道暂无版本：显示占位状态，不出安装按钮', async () => {
    api.getMillforgeIndex.mockResolvedValue(EMPTY_INDEX);
    render(<WorkerQwenCodeBridgeCard workerName="w1" runtime="qwenpaw" />);

    expect(await screen.findByText('该频道暂无版本')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /安装|更新|降级/ })).not.toBeInTheDocument();
  });

  it('索引失败：显示「索引获取失败 · 重试」，重试后恢复', async () => {
    api.getMillforgeIndex
      .mockRejectedValueOnce(new ApiError('上游不可达', 502, '/millforge/index'))
      .mockResolvedValue(STABLE_INDEX);
    render(<WorkerQwenCodeBridgeCard workerName="w1" runtime="qwenpaw" />);

    expect(await screen.findByText('索引获取失败 · 重试')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByText('未装')).toBeInTheDocument();
    expect(api.getMillforgeIndex).toHaveBeenCalledTimes(2);
  });

  it('安装失败 409：展示 sha 校验失败文案并 toast', async () => {
    api.installWorkerPlugin.mockRejectedValue(new ApiError('sha mismatch', 409, '/install'));
    render(<WorkerQwenCodeBridgeCard workerName="w1" runtime="qwenpaw" />);

    fireEvent.click(await screen.findByRole('button', { name: /安装 0\.3\.0/ }));

    expect(await screen.findByText(/sha256 不匹配/)).toBeInTheDocument();
    expect(toastMock.error).toHaveBeenCalled();
    expect(screen.getByText('未装')).toBeInTheDocument();
  });

  it('插件列表不可用（404）时提示无法检测已装版本，仍可安装', async () => {
    api.getWorkerPlugins.mockRejectedValue(new ApiError('not found', 404, '/plugins'));
    render(<WorkerQwenCodeBridgeCard workerName="w1" runtime="qwenpaw" />);

    expect(await screen.findByText(/未提供插件列表/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /安装 0\.3\.0/ })).toBeInTheDocument();
  });
});
