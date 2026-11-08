import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkerDetailDialog } from './worker-detail-dialog';
import type { WorkerResponse } from '@/lib/agentteams-api';

vi.mock('@/hooks/use-agent-health', () => ({ useAgentHealth: () => null }));

const worker = {
  name: 'w1',
  state: 'Running',
  phase: 'Running',
  runtime: 'qwenpaw',
  model: 'gpt-5',
  image: 'img:latest',
  team: 'team-alpha',
  role: 'worker',
  agents: '',
  matrixUserID: '@w1:server',
  roomID: '!room:server',
  containerManaged: true,
  containerState: 'running',
  message: '',
  skills: [],
} as unknown as WorkerResponse;

describe('WorkerDetailDialog（只读详情）', () => {
  afterEach(cleanup);

  it('renders the read-only fields', () => {
    render(<WorkerDetailDialog worker={worker} onOpenChange={() => {}} />);
    expect(screen.getByText('Worker 详情 - w1')).toBeInTheDocument();
    expect(screen.getByText('容器状态')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('team-alpha')).toBeInTheDocument();
  });

  it('does not render any configuration panels', () => {
    render(<WorkerDetailDialog worker={worker} onOpenChange={() => {}} />);
    expect(screen.queryByText('上传技能包')).not.toBeInTheDocument();
    expect(screen.queryByText('工具执行安全')).not.toBeInTheDocument();
    expect(screen.queryByText('运行时配置生效状态')).not.toBeInTheDocument();
    expect(screen.queryByText('已分发技能（磁盘文件）')).not.toBeInTheDocument();
  });
});
