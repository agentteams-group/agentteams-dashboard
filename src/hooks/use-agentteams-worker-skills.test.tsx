import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useUploadWorkerSkill } from './use-agentteams-worker-skills';
import { agentteamsApi } from '@/lib/agentteams-api';

vi.mock('@/lib/agentteams-api', () => ({
  agentteamsApi: {
    uploadWorkerSkill: vi.fn(),
    appendWorkerSkill: vi.fn(),
    restartWorker: vi.fn(),
  },
}));

const mockedApi = agentteamsApi as unknown as {
  uploadWorkerSkill: ReturnType<typeof vi.fn>;
  appendWorkerSkill: ReturnType<typeof vi.fn>;
  restartWorker: ReturnType<typeof vi.fn>;
};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrap(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const fakeFile = new File([new Uint8Array([1, 2, 3])], 'pkg.zip', {
  type: 'application/zip',
});

const uploadResponse = {
  success: true,
  skillName: 'my-skill',
  description: 'desc',
  filesCount: 2,
  prefix: 'agents/worker-1/skills/my-skill/',
  note: '已写入',
};

describe('useUploadWorkerSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uploads the file with restart=false before reconciling spec.skills', async () => {
    mockedApi.uploadWorkerSkill.mockResolvedValueOnce(uploadResponse);
    mockedApi.appendWorkerSkill.mockResolvedValueOnce({ name: 'worker-1', skills: ['my-skill'] });
    mockedApi.restartWorker.mockResolvedValueOnce({ success: true, note: 'reloaded' });

    const qc = makeQueryClient();
    const { result } = renderHook(() => useUploadWorkerSkill(), { wrapper: wrap(qc) });

    await act(async () => {
      await result.current.mutateAsync({ workerName: 'worker-1', file: fakeFile });
    });

    expect(mockedApi.uploadWorkerSkill).toHaveBeenCalledWith(
      'worker-1',
      fakeFile,
      null,
      expect.objectContaining({ restart: false }),
    );

    await waitFor(() => {
      expect(mockedApi.appendWorkerSkill).toHaveBeenCalledWith('worker-1', 'my-skill');
      // spec.skills is updated BEFORE restart.
      const uploadCallOrder = mockedApi.uploadWorkerSkill.mock.invocationCallOrder[0]!;
      const updateCallOrder = mockedApi.appendWorkerSkill.mock.invocationCallOrder[0]!;
      const restartCallOrder = mockedApi.restartWorker.mock.invocationCallOrder[0]!;
      expect(uploadCallOrder).toBeLessThan(updateCallOrder);
      expect(updateCallOrder).toBeLessThan(restartCallOrder);
    });
  });

  it('treats a successful atomic append as specUpdated', async () => {
    mockedApi.uploadWorkerSkill.mockResolvedValueOnce(uploadResponse);
    mockedApi.appendWorkerSkill.mockResolvedValueOnce({ name: 'worker-1', skills: ['my-skill'] });
    mockedApi.restartWorker.mockResolvedValueOnce({ success: true, note: 'reloaded' });

    const qc = makeQueryClient();
    const { result } = renderHook(() => useUploadWorkerSkill(), { wrapper: wrap(qc) });

    let res;
    await act(async () => {
      res = await result.current.mutateAsync({ workerName: 'worker-1', file: fakeFile });
    });

    expect(mockedApi.appendWorkerSkill).toHaveBeenCalledTimes(1);
    expect(res!.specUpdated).toBe(true);
    expect(res!.specError).toBeUndefined();
  });

  it('reports specUpdated=false and surfaces specError when appendWorkerSkill fails', async () => {
    mockedApi.uploadWorkerSkill.mockResolvedValueOnce(uploadResponse);
    mockedApi.appendWorkerSkill.mockRejectedValueOnce(new Error('controller 502'));

    const qc = makeQueryClient();
    const { result } = renderHook(() => useUploadWorkerSkill(), { wrapper: wrap(qc) });

    let res;
    await act(async () => {
      res = await result.current.mutateAsync({ workerName: 'worker-1', file: fakeFile });
    });

    expect(res!.specUpdated).toBe(false);
    expect(res!.specError).toBe('controller 502');
    // We must not reload the worker when spec.skills could not be updated.
    expect(mockedApi.restartWorker).not.toHaveBeenCalled();
  });

  it('reports reloadError when the worker reload itself fails', async () => {
    mockedApi.uploadWorkerSkill.mockResolvedValueOnce(uploadResponse);
    mockedApi.appendWorkerSkill.mockResolvedValueOnce({ name: 'worker-1', skills: ['my-skill'] });
    mockedApi.restartWorker.mockRejectedValueOnce(new Error('controller unreachable'));

    const qc = makeQueryClient();
    const { result } = renderHook(() => useUploadWorkerSkill(), { wrapper: wrap(qc) });

    let res;
    await act(async () => {
      res = await result.current.mutateAsync({ workerName: 'worker-1', file: fakeFile });
    });

    expect(res!.specUpdated).toBe(true);
    expect(res!.reloadError).toBe('controller unreachable');
  });

  it('skips the reload when reloadAfterSpec=false', async () => {
    mockedApi.uploadWorkerSkill.mockResolvedValueOnce(uploadResponse);
    mockedApi.appendWorkerSkill.mockResolvedValueOnce({ name: 'worker-1', skills: ['my-skill'] });

    const qc = makeQueryClient();
    const { result } = renderHook(() => useUploadWorkerSkill(), { wrapper: wrap(qc) });

    await act(async () => {
      await result.current.mutateAsync({
        workerName: 'worker-1',
        file: fakeFile,
        options: { reloadAfterSpec: false },
      });
    });

    expect(mockedApi.restartWorker).not.toHaveBeenCalled();
  });

  it('lets the file upload failure bubble up without touching spec.skills', async () => {
    mockedApi.uploadWorkerSkill.mockRejectedValueOnce(new Error('upload boom'));

    const qc = makeQueryClient();
    const { result } = renderHook(() => useUploadWorkerSkill(), { wrapper: wrap(qc) });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ workerName: 'worker-1', file: fakeFile }),
      ).rejects.toThrow('upload boom');
    });

    expect(mockedApi.appendWorkerSkill).not.toHaveBeenCalled();
    expect(mockedApi.restartWorker).not.toHaveBeenCalled();
  });
});
