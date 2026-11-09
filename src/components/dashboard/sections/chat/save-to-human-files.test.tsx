import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { agentteamsApi } from '@/lib/agentteams-api';
import { humanFilesApi } from '@/lib/human-files-api';
import { ApiError } from '@/lib/api-error';
import { SaveToHumanFiles } from './save-to-human-files';

vi.mock('@/lib/agentteams-api', () => ({ agentteamsApi: { getHuman: vi.fn() } }));
vi.mock('@/lib/human-files-api', () => ({ humanFilesApi: { uploadFile: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
  useAgentTeamsStore.setState({ sessionUser: 'alice', userLevel: 2 });
  useMatrixStore.setState({ userId: '@alice:test', accessToken: 'matrix-token' });
  vi.mocked(agentteamsApi.getHuman).mockResolvedValue({ name: 'alice', matrixUserID: '@alice:test' } as Awaited<ReturnType<typeof agentteamsApi.getHuman>>);
  vi.mocked(humanFilesApi.uploadFile).mockResolvedValue({ path: '', size: 3, etag: '', via: 'direct' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['abc']) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function show(filename = 'report.md') {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><SaveToHumanFiles filename={filename} mediaUrl="mxc://test/media" homeserver="http://test" /></QueryClientProvider>);
  return invalidate;
}

describe('SaveToHumanFiles', () => {
  it('copies authenticated media to the current Human and refreshes their file queries', async () => {
    const invalidate = show('../report.md');
    fireEvent.click(screen.getByRole('button', { name: '保存到我的文件' }));
    expect(await screen.findByRole('button', { name: '已保存到我的文件' })).toBeDisabled();
    expect(agentteamsApi.getHuman).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/matrix/media/'), expect.objectContaining({ headers: { Authorization: 'Bearer matrix-token' } }));
    expect(humanFilesApi.uploadFile).toHaveBeenCalledWith('alice', expect.stringMatching(/^聊天附件\/\d+-report\.md$/), expect.any(Blob), { fileName: 'report.md' });
    expect(invalidate).toHaveBeenCalled();
  });

  it('does not write to a Human whose Matrix identity differs from the current account', async () => {
    useAgentTeamsStore.setState({ userLevel: 3 });
    vi.mocked(agentteamsApi.getHuman).mockResolvedValue({ name: 'alice', matrixUserID: '@someone-else:test' } as Awaited<ReturnType<typeof agentteamsApi.getHuman>>);
    show();
    fireEvent.click(screen.getByRole('button', { name: '保存到我的文件' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Human');
    expect(fetch).not.toHaveBeenCalled();
    expect(humanFilesApi.uploadFile).not.toHaveBeenCalled();
  });

  it('reports failed media downloads and permits retry without claiming success', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403 } as Response);
    show();
    fireEvent.click(screen.getByRole('button', { name: '保存到我的文件' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('403');
    expect(humanFilesApi.uploadFile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '保存到我的文件' })).toBeEnabled();
  });

  it('does not expose the Matrix token to external attachment URLs', async () => {
    render(<QueryClientProvider client={new QueryClient()}><SaveToHumanFiles filename="report.md" mediaUrl="https://example.org/report.md" homeserver="http://test" /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: '保存到我的文件' }));
    await screen.findByRole('button', { name: '已保存到我的文件' });
    expect(fetch).toHaveBeenCalledWith('https://example.org/report.md', { headers: {} });
  });

  it('reports upload failure without showing a saved result', async () => {
    vi.mocked(humanFilesApi.uploadFile).mockRejectedValue(new Error('配额不足'));
    show();
    fireEvent.click(screen.getByRole('button', { name: '保存到我的文件' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('配额不足');
    expect(screen.queryByRole('button', { name: '已保存到我的文件' })).toBeNull();
  });

  it('explains when a Global Admin has no personal Human binding', async () => {
    useAgentTeamsStore.setState({ userLevel: 3 });
    vi.mocked(agentteamsApi.getHuman).mockRejectedValue(new ApiError('not found', 404, '/humans/alice'));
    show();
    fireEvent.click(screen.getByRole('button', { name: '保存到我的文件' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('尚未绑定个人文件区');
    expect(fetch).not.toHaveBeenCalled();
    expect(humanFilesApi.uploadFile).not.toHaveBeenCalled();
  });
});
