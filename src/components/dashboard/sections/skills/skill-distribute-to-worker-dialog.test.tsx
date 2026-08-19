import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SkillDistributeToWorkerDialog } from './skill-distribute-to-worker-dialog';

const mockWorkers = [
  { name: 'worker-a', runtime: 'openclaw', skills: [] },
  { name: 'worker-b', runtime: 'openclaw', skills: [] },
];

vi.mock('@/hooks/use-agentteams-workers', () => ({
  useWorkers: () => ({ data: mockWorkers }),
}));

const mockDownloadSkill = vi.fn();
const mockUploadWorkerSkill = vi.fn();
const mockGetWorker = vi.fn();
const mockUpdateWorker = vi.fn();
const mockRestartWorker = vi.fn();

vi.mock('@/lib/agentteams-api', () => ({
  agentteamsApi: {
    downloadSkill: (..._args: unknown[]) => mockDownloadSkill(..._args),
    downloadNacosSkill: vi.fn(),
    uploadWorkerSkill: (..._args: unknown[]) => mockUploadWorkerSkill(..._args),
    getWorker: (..._args: unknown[]) => mockGetWorker(..._args),
    updateWorker: (..._args: unknown[]) => mockUpdateWorker(..._args),
    restartWorker: (..._args: unknown[]) => mockRestartWorker(..._args),
  },
}));

function makeFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'pkg.zip', { type: 'application/zip' });
}

describe('SkillDistributeToWorkerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDownloadSkill.mockResolvedValue(makeFile());
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the dialog title and skill name', () => {
    render(
      <SkillDistributeToWorkerDialog skillName="my-skill" open onOpenChange={() => {}} />,
    );
    expect(screen.getByText('分发技能到 Worker')).toBeInTheDocument();
    expect(screen.getByText('my-skill')).toBeInTheDocument();
  });

  it('reconciles spec.skills for each worker against the controller snapshot', async () => {
    mockUploadWorkerSkill.mockResolvedValue({
      success: true,
      skillName: 'my-skill',
      description: 'desc',
      filesCount: 1,
      prefix: 'agents/worker-a/skills/my-skill/',
      note: 'ok',
    });
    // Both workers start with an empty spec.skills.
    mockGetWorker.mockImplementation(async (name: string) => ({
      name,
      skills: [] as string[],
    }));
    mockUpdateWorker.mockImplementation(async (name: string, data: { skills: string[] }) => ({
      name,
      skills: data.skills,
    }));
    mockRestartWorker.mockResolvedValue({ success: true, note: 'reloaded' });

    render(
      <SkillDistributeToWorkerDialog skillName="my-skill" open onOpenChange={() => {}} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /worker-a/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /worker-b/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /分发到/ }));
    });

    await waitFor(() => {
      expect(mockUploadWorkerSkill).toHaveBeenCalledTimes(2);
      expect(mockUploadWorkerSkill).toHaveBeenNthCalledWith(
        1,
        'worker-a',
        expect.any(File),
        'openclaw',
        expect.objectContaining({ restart: false }),
      );
      expect(mockUploadWorkerSkill).toHaveBeenNthCalledWith(
        2,
        'worker-b',
        expect.any(File),
        'openclaw',
        expect.objectContaining({ restart: false }),
      );
      expect(mockUpdateWorker).toHaveBeenCalledTimes(2);
      expect(mockUpdateWorker).toHaveBeenCalledWith('worker-a', { skills: ['my-skill'] });
      expect(mockUpdateWorker).toHaveBeenCalledWith('worker-b', { skills: ['my-skill'] });
    });
  });

  it('merges against the latest spec.skills and never clobbers concurrent inserts', async () => {
    // Simulate: worker-a already has `other-skill` in spec.skills by the
    // time the dialog fetches it (a concurrent dashboard session inserted
    // it). The dialog must merge, not replace.
    mockUploadWorkerSkill.mockResolvedValue({
      success: true,
      skillName: 'my-skill',
      description: 'desc',
      filesCount: 1,
      prefix: '',
      note: 'ok',
    });
    mockGetWorker.mockImplementation(async (name: string) => {
      if (name === 'worker-a') return { name, skills: ['other-skill'] };
      return { name, skills: [] };
    });
    mockUpdateWorker.mockResolvedValue({});
    mockRestartWorker.mockResolvedValue({ success: true, note: 'reloaded' });

    render(
      <SkillDistributeToWorkerDialog skillName="my-skill" open onOpenChange={() => {}} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /worker-a/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /分发到/ }));
    });

    await waitFor(() => {
      expect(mockUpdateWorker).toHaveBeenCalledWith('worker-a', {
        skills: ['other-skill', 'my-skill'],
      });
    });
  });

  it('is idempotent: skips updateWorker when spec.skills already contains the skill', async () => {
    mockUploadWorkerSkill.mockResolvedValue({
      success: true,
      skillName: 'my-skill',
      description: 'desc',
      filesCount: 1,
      prefix: '',
      note: 'ok',
    });
    mockGetWorker.mockResolvedValue({ name: 'worker-a', skills: ['my-skill'] });
    mockRestartWorker.mockResolvedValue({ success: true, note: 'reloaded' });

    render(
      <SkillDistributeToWorkerDialog skillName="my-skill" open onOpenChange={() => {}} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /worker-a/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /分发到/ }));
    });

    await waitFor(() => {
      expect(mockUploadWorkerSkill).toHaveBeenCalledTimes(1);
      expect(mockUpdateWorker).not.toHaveBeenCalled();
    });
  });

  it('marks a worker as partial-failed and skips its reload when spec.skills update fails', async () => {
    mockUploadWorkerSkill.mockResolvedValue({
      success: true,
      skillName: 'my-skill',
      description: 'desc',
      filesCount: 1,
      prefix: '',
      note: 'ok',
    });
    // worker-a: spec update succeeds → restart.
    // worker-b: spec update fails → no restart, status = 部分失败.
    mockGetWorker.mockImplementation(async (name: string) => ({
      name,
      skills: [] as string[],
    }));
    mockUpdateWorker.mockImplementation(async (name: string) => {
      if (name === 'worker-b') throw new Error('controller 502');
      return { name, skills: ['my-skill'] };
    });
    mockRestartWorker.mockResolvedValue({ success: true, note: 'reloaded' });

    render(
      <SkillDistributeToWorkerDialog skillName="my-skill" open onOpenChange={() => {}} />,
    );

    // Select both workers and trigger distribution. The button enabled
    // state is driven by `selectedWorkers.length`; we use `act` to flush
    // React's batched setState calls between clicks.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /worker-a/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /worker-b/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /分发到/ }));
    });

    await waitFor(() => {
      expect(mockUploadWorkerSkill).toHaveBeenCalledTimes(2);
      expect(mockUpdateWorker).toHaveBeenCalledTimes(2);
      // Only worker-a is reloaded, never worker-b.
      expect(mockRestartWorker).toHaveBeenCalledTimes(1);
      expect(mockRestartWorker).toHaveBeenCalledWith('worker-a');
    });
  });

  it('marks a worker as failed when the file upload itself fails', async () => {
    mockUploadWorkerSkill.mockImplementation(async (name: string) => {
      if (name === 'worker-b') throw new Error('storage 503');
      return {
        success: true,
        skillName: 'my-skill',
        description: 'desc',
        filesCount: 1,
        prefix: '',
        note: 'ok',
      };
    });
    mockGetWorker.mockResolvedValue({ name: 'worker-a', skills: [] });
    mockUpdateWorker.mockResolvedValue({});
    mockRestartWorker.mockResolvedValue({ success: true, note: 'reloaded' });

    render(
      <SkillDistributeToWorkerDialog skillName="my-skill" open onOpenChange={() => {}} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /worker-a/ }));
    fireEvent.click(screen.getByRole('button', { name: /worker-b/ }));
    fireEvent.click(screen.getByRole('button', { name: /分发到/ }));

    await waitFor(() => {
      expect(mockUpdateWorker).toHaveBeenCalledTimes(1);
      expect(mockUpdateWorker).toHaveBeenCalledWith('worker-a', { skills: ['my-skill'] });
      expect(mockRestartWorker).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByText(/storage 503/)).toBeInTheDocument();
    });
  });
});
