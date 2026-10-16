import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkerDetailDialog } from './worker-detail-dialog';
import type { WorkerResponse } from '@/lib/agentteams-api';

// 详情弹窗会把每个面板挂到同一个父节点下；面板的 key 必须在兄弟间唯一。
// 曾经 runtime-config 与 approval 都用 key={worker.name}，同 key 使 React
// 在每次父级 reconcile 时重挂载碰撞的子树——表现 = 「Runtime 配置加载中…」
// 与「加载失败」反复交替（每次重挂载都重新 fetch）。本用例锁死该回归：
// 父级反复重渲染（worker 对象引用不变）不得让 runtime-config 再次请求。
vi.mock('@/hooks/use-agent-health', () => ({ useAgentHealth: () => null }));

const worker = {
  name: 'w1',
  state: 'Running',
  phase: 'Running',
  runtime: 'qwenpaw',
  skills: [],
} as unknown as WorkerResponse;

function Host({ worker: w }: { worker: WorkerResponse }) {
  return <WorkerDetailDialog worker={w} onOpenChange={() => {}} />;
}

describe('WorkerDetailDialog（兄弟 key 唯一性回归）', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('父级重渲染不会重挂载/重请求 runtime-config 面板', async () => {
    let runtimeFetches = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('runtime-config')) runtimeFetches += 1;
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'not found' }),
        } as Response;
      }),
    );
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <Host worker={worker} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(runtimeFetches).toBeGreaterThanOrEqual(1));
    const afterMount = runtimeFetches;

    for (let i = 0; i < 10; i += 1) {
      rerender(
        <QueryClientProvider client={qc}>
          <Host worker={worker} />
        </QueryClientProvider>,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(runtimeFetches).toBe(afterMount);
  });
});
