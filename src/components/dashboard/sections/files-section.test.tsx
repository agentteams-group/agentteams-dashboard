import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-error';
import { humanFilesApi } from '@/lib/human-files-api';
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
