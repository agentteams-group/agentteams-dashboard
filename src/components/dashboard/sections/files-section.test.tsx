import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-error';
import { humanFilesApi, type HumanFileListResponse } from '@/lib/human-files-api';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { FilesSection } from './files-section';

vi.mock('@/hooks/use-agentteams-humans', () => ({
  useHumans: () => ({ data: [], isLoading: false, isError: false }),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const ENTRIES = {
  path: '',
  entries: [
    { name: 'docs', type: 'directory' as const, size: 0 },
    { name: 'readme.md', type: 'file' as const, size: 2048, updatedAt: '2026-11-02T10:00:00Z' },
  ],
};

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FilesSection initialHuman="alice" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: ResizeObserverStub,
    configurable: true,
  });
  useAgentTeamsStore.setState({ userLevel: 2, sessionUser: 'alice@example.org' });
  vi.spyOn(humanFilesApi, 'listDirectory').mockImplementation(async (_name, dir = '') =>
    dir ? { path: dir, entries: [] } : ENTRIES,
  );
  vi.spyOn(humanFilesApi, 'listTrash').mockResolvedValue([]);
  vi.spyOn(humanFilesApi, 'getQuota').mockResolvedValue({ usedBytes: 2048, quotaBytes: 1_000_000 });
  vi.spyOn(humanFilesApi, 'download').mockResolvedValue(new Blob(['x']));
  vi.spyOn(humanFilesApi, 'readText').mockResolvedValue({ text: 'hello', etag: '"e1"' });
  vi.spyOn(humanFilesApi, 'writeFile').mockResolvedValue({ path: 'x', size: 1, etag: '"e2"' });
  vi.spyOn(humanFilesApi, 'deleteFile').mockResolvedValue({ trashId: 't1' });
  vi.spyOn(humanFilesApi, 'purgeTrash').mockResolvedValue(undefined);
  vi.spyOn(humanFilesApi, 'restoreTrash').mockResolvedValue(undefined);
  vi.spyOn(humanFilesApi, 'setQuota').mockResolvedValue(undefined);
  vi.spyOn(humanFilesApi, 'makeDirectory').mockResolvedValue(undefined);
  vi.spyOn(humanFilesApi, 'uploadFile').mockResolvedValue({ path: 'a.txt', size: 1, etag: 'e', via: 'direct' });
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:x'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FilesSection 布局与焦点', () => {
  it('默认无复选框；无修饰点击只设焦点并显示圆角详情卡', async () => {
    renderSection();
    const row = await screen.findByRole('button', { name: 'readme.md' });
    expect(screen.queryByRole('checkbox', { name: /选择 readme/ })).not.toBeInTheDocument();

    fireEvent.click(row);
    const card = await screen.findByTestId('file-detail-card');
    expect(card).toHaveClass('rounded-xl');
    expect(within(card).getAllByText('readme.md').length).toBeGreaterThan(0);
    // 焦点 ≠ 批量选择：仍无复选框。
    expect(screen.queryByRole('checkbox', { name: /选择 readme/ })).not.toBeInTheDocument();
  });

  it('「多选」进入批量选择；Ctrl 点击自动进入多选', async () => {
    renderSection();
    await screen.findByRole('button', { name: 'readme.md' });
    fireEvent.click(screen.getByRole('button', { name: /多选/ }));
    expect(await screen.findByRole('checkbox', { name: '选择 readme.md' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /多选/ }));
    expect(screen.queryByRole('checkbox', { name: '选择 readme.md' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'docs' }), { ctrlKey: true });
    expect(await screen.findByRole('checkbox', { name: '选择 docs' })).toBeInTheDocument();
  });

  it('空白点击清除焦点 / 选择 / 详情', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'readme.md' }));
    expect(await screen.findByTestId('file-detail-card')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('files-list-header'));
    await waitFor(() => expect(screen.queryByTestId('file-detail-card')).not.toBeInTheDocument());
  });

  it('列表 / 树 / 网格三视图切换', async () => {
    renderSection();
    await screen.findByRole('button', { name: 'readme.md' });

    fireEvent.click(screen.getByRole('button', { name: '树' }));
    expect(await screen.findByRole('tree', { name: '文件树' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '网格' }));
    await waitFor(() =>
      expect(screen.queryByRole('tree', { name: '文件树' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'readme.md' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '列表' }));
    expect(await screen.findByTestId('files-list-header')).toBeInTheDocument();
  });

  it('页面不提供文件同步入口', async () => {
    renderSection();
    await screen.findByRole('button', { name: 'readme.md' });
    expect(screen.queryByText(/同步/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /同步/ })).not.toBeInTheDocument();
  });

  it('403/404 列表 → 无权限或不存在占位', async () => {
    vi.spyOn(humanFilesApi, 'listDirectory').mockRejectedValue(
      new ApiError('forbidden', 404, '/api/agentteams/humans/alice/files'),
    );
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent('无权限或不存在');
  });
});

describe('FilesSection 全局搜索', () => {
  const RECURSIVE = [
    { path: 'docs/a/report.md', size: 100, updatedAt: '2026-11-02T10:00:00Z' },
  ];

  it('≥2 字符 → listRecursive(limit 1000) + 结果列表 + 隐藏面包屑', async () => {
    const spy = vi
      .spyOn(humanFilesApi, 'listRecursive')
      .mockResolvedValue({ entries: RECURSIVE, nextKey: null });
    renderSection();
    const input = await screen.findByLabelText('搜索全部文件');
    expect(input).toHaveClass('h-11');
    expect(input).toHaveAttribute('placeholder', '搜索全部文件（名称或路径）');

    fireEvent.change(input, { target: { value: 'report' } });

    expect(await screen.findByText(/搜索结果 · 1 项/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith('alice', expect.objectContaining({ limit: 1000 }));
    expect(await screen.findByRole('button', { name: 'report.md' })).toBeInTheDocument();
    expect(screen.getByText('docs/a')).toBeInTheDocument();
    // 搜索态隐藏面包屑 + 目录内容。
    expect(screen.queryByRole('button', { name: '我的文件' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'readme.md' })).not.toBeInTheDocument();
  });

  it('<2 字符只提示，不发请求且目录内容不受影响', async () => {
    renderSection();
    await screen.findByRole('button', { name: 'readme.md' });
    const spy = vi.spyOn(humanFilesApi, 'listRecursive');
    fireEvent.change(screen.getByLabelText('搜索全部文件'), { target: { value: 'r' } });

    expect(await screen.findByText('输入至少 2 个字符')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'readme.md' })).toBeInTheDocument();
  });

  it('目录结果 → 进入目录并清空搜索', async () => {
    vi.spyOn(humanFilesApi, 'listRecursive').mockResolvedValue({
      entries: RECURSIVE,
      nextKey: null,
    });
    renderSection();
    const input = await screen.findByLabelText('搜索全部文件');
    fireEvent.change(input, { target: { value: 'docs' } });

    fireEvent.click(await screen.findByRole('button', { name: 'docs' }, { timeout: 3000 }));

    await waitFor(() => expect(input).toHaveValue(''));
    await waitFor(() =>
      expect(humanFilesApi.listDirectory).toHaveBeenCalledWith('alice', 'docs', expect.anything()),
    );
    expect(await screen.findByRole('button', { name: '我的文件' })).toBeInTheDocument();
  });

  it('文件结果 → 选中详情但保留搜索结果', async () => {
    vi.spyOn(humanFilesApi, 'listRecursive').mockResolvedValue({
      entries: RECURSIVE,
      nextKey: null,
    });
    renderSection();
    const input = await screen.findByLabelText('搜索全部文件');
    fireEvent.change(input, { target: { value: 'report' } });

    fireEvent.click(await screen.findByRole('button', { name: 'report.md' }, { timeout: 3000 }));

    expect(await screen.findByTestId('file-detail-card')).toBeInTheDocument();
    expect(screen.getByText(/搜索结果 · 1 项/)).toBeInTheDocument();
    expect(input).toHaveValue('report');
  });

  it('404/403/501 → 全局搜索不可用，目录内容照常', async () => {
    vi.spyOn(humanFilesApi, 'listRecursive').mockRejectedValue(
      new ApiError('forbidden', 404, '/api/agentteams/humans/alice/files'),
    );
    renderSection();
    fireEvent.change(await screen.findByLabelText('搜索全部文件'), {
      target: { value: 'rep' },
    });

    expect(await screen.findByText(/全局搜索不可用/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'readme.md' })).toBeInTheDocument();
  });

  it('nextKey → 「结果基于前 N 项」+ 加载更多（显式 cursor）', async () => {
    const spy = vi
      .spyOn(humanFilesApi, 'listRecursive')
      .mockResolvedValueOnce({ entries: [{ path: 'docs/a.txt', size: 1 }], nextKey: 'k1' })
      .mockResolvedValueOnce({ entries: [{ path: 'docs/b.txt', size: 2 }], nextKey: null });
    renderSection();
    fireEvent.change(await screen.findByLabelText('搜索全部文件'), {
      target: { value: 'docs' },
    });

    expect(await screen.findByText(/结果基于前 2 项/, {}, { timeout: 3000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));

    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith(
        'alice',
        expect.objectContaining({ cursor: 'k1', limit: 1000 }),
      ),
    );
    expect(await screen.findByRole('button', { name: 'b.txt' })).toBeInTheDocument();
  });
});

describe('FilesSection 操作', () => {
  it('上传队列：选择文件 → uploadFile 到当前目录', async () => {
    renderSection();
    await screen.findByRole('button', { name: 'readme.md' });
    const input = screen.getByTestId('files-upload-input') as HTMLInputElement;
    const file = new File(['abc'], 'a.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(humanFilesApi.uploadFile).toHaveBeenCalled());
    const [name, path] = vi.mocked(humanFilesApi.uploadFile).mock.calls[0];
    expect(name).toBe('alice');
    expect(path).toBe('a.txt');
    expect(await screen.findByTestId('upload-queue')).toBeInTheDocument();
  });

  it('重命名：读 → 写新名 → 删旧名', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'readme.md' }));
    fireEvent.click(await screen.findByRole('button', { name: /重命名/ }));
    const input = await screen.findByLabelText('新名称');
    fireEvent.change(input, { target: { value: 'renamed.md' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(humanFilesApi.writeFile).toHaveBeenCalledWith(
        'alice',
        'renamed.md',
        expect.anything(),
      ),
    );
    expect(humanFilesApi.deleteFile).toHaveBeenCalledWith('alice', 'readme.md');
    expect(humanFilesApi.purgeTrash).toHaveBeenCalledWith('alice', 't1');
  });

  it('移动：目标目录 + 文件名', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'readme.md' }));
    fireEvent.click(await screen.findByRole('button', { name: /移动/ }));
    const input = await screen.findByLabelText(/目标目录/);
    fireEvent.change(input, { target: { value: 'docs' } });
    fireEvent.click(screen.getByRole('button', { name: '移动' }));

    await waitFor(() =>
      expect(humanFilesApi.writeFile).toHaveBeenCalledWith(
        'alice',
        'docs/readme.md',
        expect.anything(),
      ),
    );
  });

  it('删除：确认后 deleteFile（软删）', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'readme.md' }));
    const card = await screen.findByTestId('file-detail-card');
    fireEvent.click(within(card).getByRole('button', { name: /删除/ }));

    const dialog = await screen.findByRole('dialog');
    const buttons = within(dialog).getAllByRole('button', { name: '删除' });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(humanFilesApi.deleteFile).toHaveBeenCalledWith('alice', 'readme.md'));
  });

  it('回收站：恢复调用 restoreTrash', async () => {
    vi.spyOn(humanFilesApi, 'listTrash').mockResolvedValue([
      { id: 't9', path: 'old.txt', size: 10, deletedAt: '2026-11-01T00:00:00Z' },
    ]);
    renderSection();
    await screen.findByRole('button', { name: 'readme.md' });
    fireEvent.click(screen.getByRole('button', { name: /回收站/ }));
    const restore = await screen.findByRole('button', { name: '恢复 old.txt' });
    fireEvent.click(restore);
    await waitFor(() => expect(humanFilesApi.restoreTrash).toHaveBeenCalledWith('alice', 't9', false));
  });

  it('配额：MB 输入 → setQuota 字节（十进制）', async () => {
    useAgentTeamsStore.setState({ userLevel: 3, sessionUser: 'admin' });
    renderSection();
    await screen.findByRole('button', { name: 'readme.md' });
    fireEvent.click(screen.getByRole('button', { name: '编辑配额' }));
    const input = await screen.findByLabelText('容量');
    fireEvent.change(input, { target: { value: '2' } });
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(humanFilesApi.setQuota).toHaveBeenCalledWith('alice', 2_000_000));
  });
});

describe('FilesSection 刷新与远端变化', () => {
  it('手动刷新：按钮在飞时禁用，旧列表留在屏上（不换骨架）', async () => {
    const pending: { resolve?: (_value: HumanFileListResponse) => void } = {};
    vi.mocked(humanFilesApi.listDirectory)
      .mockResolvedValueOnce(ENTRIES)
      .mockImplementationOnce(
        () => new Promise<HumanFileListResponse>((resolve) => { pending.resolve = resolve; }),
      );
    renderSection();
    await screen.findByRole('button', { name: 'readme.md' });

    const refresh = screen.getByRole('button', { name: '刷新' });
    fireEvent.click(refresh);
    await waitFor(() => expect(refresh).toBeDisabled());
    // 旧数据原位保留：没有骨架，只有一条轻量「后台更新中」提示。
    expect(screen.getByRole('button', { name: 'readme.md' })).toBeInTheDocument();
    expect(screen.getByTestId('files-updating-bar')).toBeInTheDocument();
    expect(document.querySelector('.shimmer')).toBeNull();

    pending.resolve?.(ENTRIES);
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled());
  });

  it('刷新保留焦点与选中：条目仍在则原地不动', async () => {
    renderSection();
    await screen.findByRole('button', { name: 'readme.md' });
    fireEvent.click(screen.getByRole('button', { name: /多选/ }));
    // 多选态下无修饰点击 = 聚焦 + 选中该项。
    fireEvent.click(screen.getByRole('button', { name: 'readme.md' }));
    expect(await screen.findByTestId('file-detail-card')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选择 readme.md' })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(humanFilesApi.listDirectory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled());

    expect(screen.getByTestId('file-detail-card')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选择 readme.md' })).toBeChecked();
  });

  it('刷新后条目消失：摘掉选中 / 关掉详情并提示', async () => {
    renderSection();
    await screen.findByRole('button', { name: 'readme.md' });
    fireEvent.click(screen.getByRole('button', { name: /多选/ }));
    fireEvent.click(screen.getByRole('button', { name: 'readme.md' }));
    expect(await screen.findByTestId('file-detail-card')).toBeInTheDocument();
    const info = vi.spyOn(toast, 'info');

    vi.mocked(humanFilesApi.listDirectory).mockResolvedValueOnce({
      path: '',
      entries: [{ name: 'docs', type: 'directory', size: 0 }],
    });
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));

    await waitFor(() => expect(screen.queryByTestId('file-detail-card')).not.toBeInTheDocument());
    await waitFor(() => expect(info).toHaveBeenCalled());
    expect(String(info.mock.calls[0][0])).toMatch(/已从选择中移除/);
    expect(screen.queryByRole('button', { name: 'readme.md' })).not.toBeInTheDocument();
  });

  it('搜索词变化：旧结果留屏到新结果到达（keepPreviousData）', async () => {
    const pending: { resolve?: (_value: { entries: { path: string; size: number }[]; nextKey: null }) => void } = {};
    const spy = vi
      .spyOn(humanFilesApi, 'listRecursive')
      .mockResolvedValueOnce({ entries: [{ path: 'docs/report.md', size: 10 }], nextKey: null })
      .mockImplementationOnce(
        () => new Promise((resolve) => { pending.resolve = resolve; }),
      );
    renderSection();
    const input = await screen.findByLabelText('搜索全部文件');
    fireEvent.change(input, { target: { value: 'repo' } });
    expect(await screen.findByRole('button', { name: 'report.md' }, { timeout: 3000 })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'report' } });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2), { timeout: 3000 });
    // 新结果未回：上一批结果不闪空，配「后台更新中」提示。
    expect(screen.getByRole('button', { name: 'report.md' })).toBeInTheDocument();
    expect(screen.getByTestId('files-updating-bar')).toBeInTheDocument();

    pending.resolve?.({ entries: [], nextKey: null });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'report.md' })).not.toBeInTheDocument(),
    );
  });

  it('递归翻页失败：已加载页保留，重试沿用原 cursor', async () => {
    const spy = vi
      .spyOn(humanFilesApi, 'listRecursive')
      .mockResolvedValueOnce({ entries: [{ path: 'a.txt', size: 1 }], nextKey: 'k1' })
      .mockRejectedValueOnce(new ApiError('boom', 500, '/api/agentteams/humans/alice/files'))
      .mockResolvedValueOnce({ entries: [{ path: 'b.txt', size: 2 }], nextKey: null });
    renderSection();
    await screen.findByRole('button', { name: 'readme.md' });
    fireEvent.click(screen.getByRole('button', { name: '全部文件' }));
    expect(await screen.findByRole('button', { name: 'a.txt' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByText(/加载更多失败/)).toBeInTheDocument();
    // 失败不清场：已加载的第一页仍在。
    expect(screen.getByRole('button', { name: 'a.txt' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试加载更多' }));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith(
        'alice',
        expect.objectContaining({ cursor: 'k1' }),
      ),
    );
    expect(await screen.findByRole('button', { name: 'b.txt' })).toBeInTheDocument();
  });

  it('删除成功：当前目录原地摘掉，不整页刷新', async () => {
    const pending: { resolve?: (_value: HumanFileListResponse) => void } = {};
    renderSection();
    await screen.findByRole('button', { name: 'readme.md' });
    vi.mocked(humanFilesApi.listDirectory).mockImplementationOnce(
      () => new Promise<HumanFileListResponse>((resolve) => { pending.resolve = resolve; }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'readme.md' }));
    const card = await screen.findByTestId('file-detail-card');
    fireEvent.click(within(card).getByRole('button', { name: /删除/ }));
    const dialog = await screen.findByRole('dialog');
    const buttons = within(dialog).getAllByRole('button', { name: '删除' });
    fireEvent.click(buttons[buttons.length - 1]);

    // 后台重取还没回来，行已按乐观补丁消失。
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'readme.md' })).not.toBeInTheDocument(),
    );
    pending.resolve?.({ path: '', entries: [{ name: 'docs', type: 'directory', size: 0 }] });
  });

  it('删除失败：回滚列表（行仍在）', async () => {
    vi.mocked(humanFilesApi.deleteFile).mockRejectedValueOnce(
      new ApiError('nope', 500, '/api/agentteams/humans/alice/files/readme.md'),
    );
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'readme.md' }));
    const card = await screen.findByTestId('file-detail-card');
    fireEvent.click(within(card).getByRole('button', { name: /删除/ }));
    const dialog = await screen.findByRole('dialog');
    const buttons = within(dialog).getAllByRole('button', { name: '删除' });
    fireEvent.click(buttons[buttons.length - 1]);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // 弹窗保持打开（错误就地提示）；关掉后列表已回滚。
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(await screen.findByRole('button', { name: 'readme.md' })).toBeInTheDocument();
  });
});
