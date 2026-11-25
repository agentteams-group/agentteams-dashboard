import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersonalFilePicker } from './PersonalFilePicker';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { agentteamsApi } from '@/lib/agentteams-api';
import { humanFilesApi } from '@/lib/human-files-api';

vi.mock('@/lib/agentteams-api', () => ({ agentteamsApi: { listHumans: vi.fn() } }));
vi.mock('@/lib/human-files-api', async original => ({ ...await original<typeof import('@/lib/human-files-api')>(), humanFilesApi: { listDirectory: vi.fn(), download: vi.fn() } }));
beforeEach(() => {
  vi.resetAllMocks();
  useAgentTeamsStore.setState({ sessionUser: 'alice-resource', userLevel: 2 });
  useMatrixStore.setState({ userId: '@alice:test' });
  vi.mocked(humanFilesApi.listDirectory).mockResolvedValue({ path: '', entries: [{ name: 'docs', type: 'directory', size: 0 }] });
  vi.mocked(humanFilesApi.download).mockResolvedValue(new Blob(['report'], { type: 'text/markdown' }));
});
afterEach(cleanup);
function show() {
  const send = vi.fn().mockResolvedValue(undefined);
  const done = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><PersonalFilePicker onSend={send} onDone={done} /></QueryClientProvider>);
  return { send, done };
}

it('browses nested files and sends actual bytes using the verified ordinary Human resource', async () => {
  const { send, done } = show();
  const docs = await screen.findByRole('button', { name: 'docs' });
  vi.mocked(humanFilesApi.listDirectory).mockResolvedValue({ path: 'docs', entries: [{ name: '报告.md', path: 'docs/报告.md', type: 'file', size: 6 }] });
  fireEvent.click(docs);
  await waitFor(() => expect(humanFilesApi.listDirectory).toHaveBeenCalledWith('alice-resource', 'docs'));
  fireEvent.click(await screen.findByRole('radio', { name: '报告.md' }));
  fireEvent.click(screen.getByRole('button', { name: '发送到当前会话' }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(agentteamsApi.listHumans).not.toHaveBeenCalled();
  expect(humanFilesApi.download).toHaveBeenCalledWith('alice-resource', 'docs/报告.md', { size: 6 });
  const file = send.mock.calls[0][0] as File;
  expect(file.name).toBe('报告.md');
  expect(file.size).toBe(6);
  expect(file.type).toBe('text/markdown');
});

it('resolves admin by Matrix identity rather than selecting another user', async () => {
  useAgentTeamsStore.setState({ sessionUser: 'admin', userLevel: 3 });
  vi.mocked(agentteamsApi.listHumans).mockResolvedValue([{ name: 'wrong', matrixUserID: '@other:test' }, { name: 'admin-human', matrixUserID: '@alice:test' }] as Awaited<ReturnType<typeof agentteamsApi.listHumans>>);
  show();
  await screen.findByRole('button', { name: 'docs' });
  expect(humanFilesApi.listDirectory).toHaveBeenCalledWith('admin-human', '');
});

it('does not browse other Humans when the admin identity is missing', async () => {
  useAgentTeamsStore.setState({ userLevel: 3 });
  vi.mocked(agentteamsApi.listHumans).mockResolvedValue([{ name: 'other', matrixUserID: '@other:test' }] as Awaited<ReturnType<typeof agentteamsApi.listHumans>>);
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('尚未就绪');
  expect(humanFilesApi.listDirectory).not.toHaveBeenCalled();
});

it('keeps the dialog open and permits retry after a file download failure', async () => {
  vi.mocked(humanFilesApi.listDirectory).mockResolvedValue({ path: '', entries: [{ name: 'file.txt', type: 'file', size: 6 }] });
  vi.mocked(humanFilesApi.download).mockRejectedValueOnce(new Error('读取失败'));
  const { send, done } = show();
  fireEvent.click(await screen.findByRole('radio', { name: 'file.txt' }));
  fireEvent.click(screen.getByRole('button', { name: '发送到当前会话' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('读取失败');
  expect(send).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '发送到当前会话' }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
});
