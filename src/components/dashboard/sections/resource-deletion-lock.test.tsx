import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import { WorkerCard } from './workers/worker-card';
import { TeamCard } from './teams/team-card';

const worker: WorkerResponse = {
  name: 'worker-a',
  phase: 'Running',
  state: 'Running',
  runtime: 'openclaw',
  containerManaged: false,
  model: '',
  image: '',
  containerState: '',
  matrixUserID: '',
  roomID: '',
  message: '',
  team: '',
  role: '',
};

const team: TeamResponse = {
  name: 'team-a',
  teamName: 'Team A',
  description: '',
  phase: 'Active',
  leaderName: '',
  leaderReady: true,
  totalWorkers: 0,
  readyWorkers: 0,
  workerNames: [],
  humanMembers: [],
  workerExposedPorts: {},
  teamRoomID: '!room:matrix',
  leaderDMRoomID: '',
  message: '',
  workerIdleTimeout: '30m',
  leaderHeartbeat: null,
  admin: null,
};

describe('resource deletion lock', () => {
  afterEach(cleanup);

  it('keeps only Worker details available while deleting', () => {
    render(
      <WorkerCard
        worker={worker}
        index={0}
        isSelected={false}
        isDeleting
        isActionPending={false}
        onToggleSelect={vi.fn()}
        onView={vi.fn()}
        onEdit={vi.fn()}
        onWake={vi.fn()}
        onSleep={vi.fn()}
        onEnsureReady={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('删除中');
    expect((screen.getByRole('button', { name: '详情' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: '编辑' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '休眠' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '删除' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps only team details available while deleting', () => {
    render(
      <TeamCard
        team={team}
        index={0}
        availableWorkers={[]}
        isAddWorkerOpen={false}
        isDeleting
        onAddWorkerPopoverChange={vi.fn()}
        onView={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAddWorker={vi.fn()}
        onShowTopology={vi.fn()}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('删除中');
    expect((screen.getByRole('button', { name: '详情' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: '为 team-a 添加 Worker' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '查看 team-a 拓扑' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '编辑 team-a' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '删除 team-a' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '复制' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
