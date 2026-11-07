import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-error';
import { humanFilesApi } from '@/lib/human-files-api';
import { HumanFilesPanel } from './human-files-panel';

function renderPanel() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <HumanFilesPanel humanName="alice" active />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HumanFilesPanel', () => {
  it('403 → 无权限（no retry button, the denial is not transient）', async () => {
    vi.spyOn(humanFilesApi, 'listDirectory').mockRejectedValue(
      new ApiError('forbidden', 403, '/api/agentteams/humans/alice/files'),
    );
    renderPanel();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('无权限');
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it('404 → 不存在或不可见（controller hides "missing" and "not visible" alike）', async () => {
    vi.spyOn(humanFilesApi, 'listDirectory').mockRejectedValue(
      new ApiError('not found', 404, '/api/agentteams/humans/alice/files'),
    );
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('不存在或不可见');
  });

  it('lists a directory, enters a subdirectory and offers a download per file', async () => {
    const listDirectory = vi
      .spyOn(humanFilesApi, 'listDirectory')
      .mockResolvedValueOnce({
        path: 'files/',
        entries: [
          { name: 'docs', type: 'directory', size: 0 },
          { name: 'readme.md', type: 'file', size: 2048 },
        ],
      })
      .mockResolvedValueOnce({
        path: 'files/docs/',
        entries: [{ name: 'a.md', type: 'file', size: 10 }],
      });
    renderPanel();

    expect(await screen.findByText('readme.md')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /docs/ }));

    expect(await screen.findByText('a.md')).toBeInTheDocument();
    expect(listDirectory).toHaveBeenLastCalledWith('alice', 'docs');
    // Breadcrumb: the root crumb ("文件") plus the current directory segment,
    // alongside the view switch that also reads 文件.
    expect(screen.getAllByRole('button', { name: '文件' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'docs' })).toBeInTheDocument();
  });

  it('downloads through the API with the files-relative path', async () => {
    vi.spyOn(humanFilesApi, 'listDirectory').mockResolvedValue({
      path: 'files/docs/',
      entries: [{ name: 'a.md', type: 'file', size: 10 }],
    });
    const download = vi.spyOn(humanFilesApi, 'download').mockResolvedValue(new Blob(['x']));
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: '下载 a.md' }));

    await waitFor(() => expect(download).toHaveBeenCalledWith('alice', 'a.md'));
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });

  it('回收站 shows the original path, size and deleter (read-only)', async () => {
    vi.spyOn(humanFilesApi, 'listDirectory').mockResolvedValue({ path: 'files/', entries: [] });
    vi.spyOn(humanFilesApi, 'listTrash').mockResolvedValue([
      {
        id: '20261101T090000Z-aaaa',
        path: 'docs/a.md',
        size: 2048,
        deletedAt: '2026-11-01T09:00:00Z',
        caller: 'alice',
        role: 'admin',
      },
    ]);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '回收站' }));

    expect(await screen.findByText('docs/a.md')).toBeInTheDocument();
    expect(screen.getByText(/删除者 alice/)).toBeInTheDocument();
    expect(screen.getByText('只读')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /下载/ })).not.toBeInTheDocument();
  });
});
