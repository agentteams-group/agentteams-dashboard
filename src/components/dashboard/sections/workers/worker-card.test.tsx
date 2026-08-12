import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkerCard } from './worker-card';
import { clearToolCallLedger, recordToolCalls } from '@/lib/tool-call-counter';
import type { WorkerResponse } from '@/lib/agentteams-api';

function makeWorker(overrides: Partial<WorkerResponse> = {}): WorkerResponse {
  return {
    name: 'worker-a',
    phase: 'Running',
    state: 'Running',
    containerManaged: true,
    model: 'gpt-5',
    runtime: 'qwenpaw',
    image: 'img:latest',
    containerState: 'running',
    matrixUserID: '@worker-a:server',
    roomID: '!room:server',
    message: '',
    team: 'team-alpha',
    role: 'member',
    ...overrides,
  };
}

function renderCard(worker: WorkerResponse, opts: { isDeleting?: boolean } = {}) {
  return render(
    <TooltipProvider>
      <WorkerCard
        worker={worker}
        index={0}
        isSelected={false}
        onToggleSelect={() => {}}
        onView={() => {}}
        onEdit={() => {}}
        onWake={() => {}}
        onSleep={() => {}}
        onEnsureReady={() => {}}
        onDelete={() => {}}
        isActionPending={false}
        isDeleting={opts.isDeleting ?? false}
      />
    </TooltipProvider>,
  );
}

afterEach(() => {
  cleanup();
  clearToolCallLedger();
});

describe('WorkerCard v2', () => {
  it('shows the header with runtime badge and health ring (AC-W2)', () => {
    renderCard(makeWorker());
    expect(screen.getByText('worker-a')).toBeInTheDocument();
    // header badge + capability strip both carry the runtime label
    expect(screen.getAllByText('QwenPaw').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('img', { name: 'Running' })).toBeInTheDocument();
  });

  it('fills the vitals strip with 暂无 when backend fields are missing (AC-W3)', () => {
    renderCard(makeWorker({ message: '' }));
    const strip = screen.getByTestId('vitals-strip');
    expect(strip).toHaveTextContent('最近任务');
    expect(strip).toHaveTextContent('持续时长');
    expect(strip).toHaveTextContent('最近活动');
    expect(strip).toHaveTextContent('工具调用');
    // all four columns fall back to 暂无
    expect(strip.querySelectorAll('p')).toHaveLength(8);
    expect(strip.textContent?.match(/暂无/g)).toHaveLength(4);
  });

  it('shows task, duration, activity and tool-call count when data exists (AC-W3)', () => {
    const now = Date.now();
    recordToolCalls('worker-a', '$evt1', 3, now);
    renderCard(
      makeWorker({
        lastTaskSummary: '处理工单 #4821',
        stateStartedAt: new Date(now - 12 * 60_000).toISOString(),
        lastActivityAt: new Date(now - 5 * 60_000).toISOString(),
      }),
    );
    const strip = screen.getByTestId('vitals-strip');
    expect(strip).toHaveTextContent('处理工单 #4821');
    expect(strip).toHaveTextContent('12 分钟');
    expect(strip).toHaveTextContent('5 分钟前');
    expect(strip).toHaveTextContent('3 次');
    expect(strip).not.toHaveTextContent('暂无');
  });

  it('narrates Running as 正在帮 {team} 处理 {task} (AC-W4)', () => {
    renderCard(makeWorker({ lastTaskSummary: '处理工单 #4821' }));
    expect(screen.getByTestId('status-narrative')).toHaveTextContent('正在帮 team-alpha 处理 处理工单 #4821');
  });

  it('falls back to message for the Running narrative when lastTaskSummary is absent', () => {
    renderCard(makeWorker({ message: '巡检日志' }));
    expect(screen.getByTestId('status-narrative')).toHaveTextContent('正在帮 team-alpha 处理 巡检日志');
  });

  it('narrates Sleeping as 空闲 {duration} from stateStartedAt (AC-W4)', () => {
    const now = Date.now();
    renderCard(
      makeWorker({
        phase: 'Sleeping',
        state: 'Sleeping',
        stateStartedAt: new Date(now - 12 * 60_000).toISOString(),
      }),
    );
    expect(screen.getByTestId('status-narrative')).toHaveTextContent('空闲 12 分钟');
  });

  it('narrates Pending / Ready / Stopped / Failed / Updating with ops wording (AC-W4)', () => {
    const cases: Array<[Partial<WorkerResponse>, string]> = [
      [{ phase: 'Pending', state: 'Stopped' }, '等待 Controller 派发镜像，预计 < 2 分钟'],
      [{ phase: 'Ready', state: 'Running' }, '已就绪，等待任务'],
      [{ phase: 'Stopped', state: 'Stopped' }, '已停机'],
      [{ phase: 'Failed', state: 'Stopped', message: 'tool_guard 拒绝\nError: stack line' }, '最近失败：tool_guard 拒绝'],
      [{ phase: 'Updating', state: 'Running' }, '正在拉取新镜像'],
    ];
    for (const [overrides, expected] of cases) {
      const { unmount } = renderCard(makeWorker(overrides));
      expect(screen.getByTestId('status-narrative')).toHaveTextContent(expected);
      unmount();
    }
  });

  it('shows the runtime capability strip with the per-runtime note (AC-W5)', () => {
    renderCard(makeWorker({ runtime: 'copaw' }));
    const strip = screen.getByTestId('runtime-feature');
    expect(strip).toHaveTextContent('CoPaw');
    expect(strip).toHaveTextContent('AgentScope 体系，思考与工具以子消息呈现');
  });

  it('renders the deleting overlay with progress and blocks interaction (AC-W6)', () => {
    renderCard(makeWorker(), { isDeleting: true });
    expect(screen.getByTestId('deleting-overlay')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('删除中，等待 Controller 完成任务');
    expect(screen.getByRole('button', { name: '选择' })).toBeDisabled();
  });

  it('uses tier wording instead of a bare health score (AC-W8)', () => {
    renderCard(makeWorker());
    // narrative area must not contain the old "健康评分 xx/100" phrasing
    expect(document.body.textContent).not.toMatch(/健康评分/);
    expect(screen.getByLabelText(/稳定运行/)).toBeInTheDocument();
  });
});
