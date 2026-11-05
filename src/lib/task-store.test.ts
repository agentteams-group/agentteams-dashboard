import { beforeEach, describe, expect, it } from 'vitest';
import { useTaskStore } from './task-store';
import type { WorkflowItem } from '@/lib/a2ui/workflow';

// f3-1：m.replace 修订（新 event_id，经 markEventSeen 去重后进入 upsertTask）
// 在同长度、整体 status 不变时也要按内容落库——否则 RoomTasksPanel /
// agent-activity-track 的步骤卡冻结到任务结束才跳变。

type UpsertTaskArg = Parameters<ReturnType<typeof useTaskStore.getState>['upsertTask']>[0];

function baseTask(overrides: Partial<UpsertTaskArg> = {}) {
  return {
    runId: 'run-1',
    title: '原始任务标题',
    status: 'running',
    roomId: '!room:example.org',
    senderMatrixUserId: '@manager:example.org',
    createdAt: 1000,
    subagents: [{ id: 'sa1', name: 'researcher', status: 'completed' }] as WorkflowItem[],
    steps: [
      { id: 's1', title: '步骤一', status: 'completed' },
      { id: 's2', title: '步骤二', status: 'pending' },
    ] as WorkflowItem[],
    ...overrides,
  };
}

describe('upsertTask 同长度内容修订（f3-1）', () => {
  beforeEach(() => {
    useTaskStore.setState({ tasks: {} });
  });

  it('同长度不同内容（step pending→completed + title 变化）且整体 status 不变的修订能落库', () => {
    useTaskStore.getState().upsertTask(baseTask(), 1000);

    useTaskStore.getState().upsertTask(
      baseTask({
        title: '修订后的任务标题',
        steps: [
          { id: 's1', title: '步骤一', status: 'completed' },
          { id: 's2', title: '步骤二', status: 'completed' },
        ] as WorkflowItem[],
      }),
      2000,
    );

    const after = useTaskStore.getState().tasks['run-1'];
    expect(after.title).toBe('修订后的任务标题');
    expect(after.steps[1].status).toBe('completed');
    expect(after.updatedAt).toBe(2000);
    // createdAt 保留首次入库值。
    expect(after.createdAt).toBe(1000);
  });

  it('subagents 内容变化（同长度）同样触发落库', () => {
    useTaskStore.getState().upsertTask(baseTask(), 1000);

    useTaskStore.getState().upsertTask(
      baseTask({
        subagents: [{ id: 'sa1', name: 'researcher', status: 'completed', summary: '已完成检索' }] as WorkflowItem[],
      }),
      2000,
    );

    expect(useTaskStore.getState().tasks['run-1'].subagents[0].summary).toBe('已完成检索');
  });

  it('完全相同内容（引用不同、深度相等）返回原 state，不产生新对象', () => {
    useTaskStore.getState().upsertTask(baseTask(), 1000);
    const beforeState = useTaskStore.getState();

    useTaskStore.getState().upsertTask(baseTask(), 1000);

    expect(useTaskStore.getState()).toBe(beforeState);
    expect(useTaskStore.getState().tasks['run-1'].updatedAt).toBe(1000);
  });

  it('同一 task 对象重放（引用相同）引用短路，同样不产生新 state', () => {
    const task = baseTask();
    useTaskStore.getState().upsertTask(task, 1000);
    const beforeState = useTaskStore.getState();

    useTaskStore.getState().upsertTask(task, 1000);

    expect(useTaskStore.getState()).toBe(beforeState);
  });
});
