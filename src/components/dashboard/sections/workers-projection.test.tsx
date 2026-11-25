import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkersSection } from './workers-section';
import { agentteamsApi, type WorkerResponse } from '@/lib/agentteams-api';
import { useAgentTeamsStore } from '@/lib/agentteams-store';

const mocks = vi.hoisted(() => ({ update: vi.fn(), refetch: vi.fn(), workers: [] as WorkerResponse[] }));
vi.mock('@/hooks/use-agentteams-workers', () => ({ useWorkers: () => ({ data: mocks.workers, refetch: mocks.refetch, isLoading: false, isError: false }) }));
vi.mock('@/lib/search-context', () => ({ useSearch: () => ({ searchQuery: '' }) }));
vi.mock('@/lib/use-view-mode', () => ({ useViewMode: () => ({ viewMode: 'table', handleViewModeChange: vi.fn() }) }));
vi.mock('@/hooks/use-model-selection', () => ({ useModelSelection: () => ({ options: [], providers: [], aiRoutes: [], sessionIssue: null }) }));
vi.mock('@/hooks/use-agentteams-mutations', () => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return { useCreateWorker: mutation, useDeleteWorker: mutation, useWakeWorker: mutation, useSleepWorker: mutation, useEnsureReadyWorker: mutation, useUpdateWorker: () => ({ mutate: mocks.update, isPending: false }) };
});
vi.mock('./workers/worker-card', () => ({ WorkerCard: ({ worker, onEdit, onView }: { worker: WorkerResponse; onEdit: () => void; onView: () => void }) => (
  <div><button onClick={onEdit}>edit-{worker.name}</button><button onClick={onView}>view-{worker.name}</button></div>
) }));
// 卡片视图已移除行内编辑；本组用例验证「详情先读后写」，走表格视图的编辑/查看入口。
vi.mock('./workers/worker-table', () => ({ WorkerTable: ({ workers, onEdit, onView }: {
  workers: WorkerResponse[];
  onEdit: (_worker: WorkerResponse) => void;
  onView: (_worker: WorkerResponse) => void;
}) => (
  <div>{workers.map((worker) => (
    <div key={worker.name}>
      <button onClick={() => onEdit(worker)}>edit-{worker.name}</button>
      <button onClick={() => onView(worker)}>view-{worker.name}</button>
    </div>
  ))}</div>
) }));
vi.mock('./workers/worker-detail-dialog', () => ({ WorkerDetailDialog: ({ worker }: { worker: WorkerResponse | null }) => worker ? <output data-testid="detail">{JSON.stringify(worker)}</output> : null }));
vi.mock('./workers/worker-edit-dialog', () => ({ WorkerEditDialog: ({ open, value, onChange, onSubmit }: { open: boolean; value: Record<string, unknown>; onChange: (_value: Record<string, unknown>) => void; onSubmit: () => void }) => open ? (
  <div><output data-testid="edit">{JSON.stringify(value)}</output><button onClick={() => onChange({ ...value, model: 'changed' })}>change-model</button><button onClick={() => onChange({ ...value, llmHeartbeatEnabled: !value.llmHeartbeatEnabled })}>toggle-heartbeat</button><button onClick={onSubmit}>save-edit</button></div>
) : null }));

const detail: WorkerResponse = {
  name: 'a', runtime: 'qwenpaw', model: 'original', phase: 'Running', state: 'Running',
  containerManaged: true, image: 'fixture', containerState: 'running', matrixUserID: '@a:fixture',
  roomID: '!a:fixture', message: '', team: '', role: '', envEditable: true,
  env: { KEEP: 'fixture' }, skills: ['existing'], agents: 'existing prompt',
  mcpServers: [{ name: 'm', url: 'http://fixture', transport: 'sse' }],
};

function renderWorkers() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><WorkersSection /></QueryClientProvider>);
}

describe('Worker list detail-before-write', () => {
  beforeEach(() => {
    mocks.update.mockReset();mocks.refetch.mockReset();localStorage.clear();
    mocks.workers = [{ name: 'a', runtime: 'qwenpaw', model: 'original', phase: 'Running' }, { name: 'b', runtime: 'qwenpaw', phase: 'Running' }] as WorkerResponse[];
    useAgentTeamsStore.setState({ isConnected: true });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })));
  });
  afterEach(() => { cleanup();vi.restoreAllMocks();vi.unstubAllGlobals(); });

  it('does not fetch per-row details while rendering the collection', () => {
    const get = vi.spyOn(agentteamsApi, 'getWorker');renderWorkers();
    expect(get).not.toHaveBeenCalled();
  });

  it('saves a heartbeat-only edit and reads the saved switch when reopened', async () => {
    let saved = { ...detail, runtime: 'openclaw' as const, llmHeartbeatEnabled: true };
    vi.spyOn(agentteamsApi, 'getWorker').mockImplementation(async () => saved);
    mocks.update.mockImplementation(({ data }, options) => {
      saved = { ...saved, ...data };
      options.onSuccess();
    });
    renderWorkers();
    fireEvent.click(screen.getByText('edit-a'));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('edit').textContent!).llmHeartbeatEnabled).toBe(true));
    fireEvent.click(screen.getByText('toggle-heartbeat'));
    fireEvent.click(screen.getByText('save-edit'));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ llmHeartbeatEnabled: false });
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty('env');
    fireEvent.click(screen.getByText('edit-a'));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('edit').textContent!).llmHeartbeatEnabled).toBe(false));
  });

  it('waits for full detail before editing and preserves existing env/skills/MCP when saving', async () => {
    let finish!: (_worker: WorkerResponse) => void;
    const get = vi.spyOn(agentteamsApi, 'getWorker').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderWorkers();fireEvent.click(screen.getByText('edit-a'));
    expect(screen.queryByTestId('edit')).toBeNull();expect(mocks.update).not.toHaveBeenCalled();
    await act(async () => finish(detail));
    expect(JSON.parse(screen.getByTestId('edit').textContent!)).toMatchObject({ skills: ['existing'], env: { KEEP: 'fixture' }, agents: 'existing prompt', mcpServers: detail.mcpServers });
    fireEvent.click(screen.getByText('change-model'));fireEvent.click(screen.getByText('save-edit'));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'a', data: expect.objectContaining({ model: 'changed', skills: ['existing'], agents: 'existing prompt', mcpServers: detail.mcpServers }) }), expect.anything());
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty('env');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('keeps details and edit controls unavailable after a failed detail read', async () => {
    vi.spyOn(agentteamsApi, 'getWorker').mockRejectedValue(new Error('offline'));
    renderWorkers();fireEvent.click(screen.getByText('edit-a'));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.queryByTestId('edit')).toBeNull();expect(screen.queryByTestId('detail')).toBeNull();expect(mocks.update).not.toHaveBeenCalled();
  });

  it('opens a view with full detail rather than the list snapshot', async () => {
    const get = vi.spyOn(agentteamsApi, 'getWorker').mockResolvedValue(detail);
    renderWorkers();fireEvent.click(screen.getByText('view-a'));
    await waitFor(() => expect(screen.getByTestId('detail').textContent).toContain('existing prompt'));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('ignores a late response from a previously selected Worker', async () => {
    const finish: Record<string, (_worker: WorkerResponse) => void> = {};
    vi.spyOn(agentteamsApi, 'getWorker').mockImplementation((name) => new Promise((resolve) => { finish[name] = resolve; }));
    renderWorkers();fireEvent.click(screen.getByText('edit-a'));fireEvent.click(screen.getByText('view-b'));
    await act(async () => finish.b({ ...detail, name: 'b' }));
    await act(async () => finish.a(detail));
    expect(JSON.parse(screen.getByTestId('detail').textContent!).name).toBe('b');expect(screen.queryByTestId('edit')).toBeNull();
  });
});
