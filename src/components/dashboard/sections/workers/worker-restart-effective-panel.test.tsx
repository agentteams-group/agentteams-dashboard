import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkerRestartEffectivePanel } from './worker-restart-effective-panel';

const originalFetch = globalThis.fetch;

type Reply = { body: unknown; status?: number };
let getReplies: Reply[] = [];
let postReplies: Reply[] = [];
let getCalls: string[] = [];
let postCalls: string[] = [];

function reply({ body, status = 200 }: Reply): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch() {
  getCalls = [];
  postCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST') {
        postCalls.push(url);
        const next = postReplies.shift() ?? { body: { name: 'w1', phase: 'Running' } };
        return reply(next);
      }
      getCalls.push(url);
      // Keep the last reply for any follow-up read (refresh / post-restart).
      const next = getReplies.length > 1 ? getReplies.shift()! : getReplies[0];
      return reply(next);
    }),
  );
}

const PENDING = {
  runtime: 'openclaw',
  rev: 'rev-1',
  values: {},
  applied: 'pending',
  pendingRestart: ['gateway.port', 'channels.telegram.enabled'],
};

const APPLIED = {
  runtime: 'openclaw',
  rev: 'rev-2',
  values: {},
  applied: 'applied',
  pendingRestart: [],
};

function renderPanel(workerName = 'w1') {
  return render(<WorkerRestartEffectivePanel workerName={workerName} />);
}

describe('WorkerRestartEffectivePanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('shows the restart button (44px) when a saved write is pending', async () => {
    getReplies = [{ body: PENDING }];
    stubFetch();
    renderPanel();

    expect(await screen.findByText('已保存，待重启生效')).toBeInTheDocument();
    expect(screen.getByText('gateway.port')).toBeInTheDocument();
    expect(screen.getByText('channels.telegram.enabled')).toBeInTheDocument();
    expect(getCalls[0]).toContain('/api/agentteams/members/w1/config');

    const button = screen.getByRole('button', { name: '重启生效' });
    expect(button).toHaveClass('h-11');
  });

  it('does not offer a restart when the config is already applied', async () => {
    getReplies = [{ body: APPLIED }];
    stubFetch();
    renderPanel();

    expect(await screen.findByText('运行时配置已生效，无需重启。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重启生效' })).not.toBeInTheDocument();
  });

  it('restarts through the controller proxy and refreshes the verdict', async () => {
    getReplies = [{ body: PENDING }, { body: APPLIED }];
    postReplies = [{ body: { name: 'w1', phase: 'Running' } }];
    stubFetch();
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: '重启生效' }));

    await waitFor(() =>
      expect(postCalls).toContain('/api/agentteams/workers/w1/runtime-config/restart/'),
    );
    expect(await screen.findByText(/重启完成（phase=Running）/)).toBeInTheDocument();
    await waitFor(() => expect(getCalls.length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole('button', { name: '重启生效' })).not.toBeInTheDocument();
  });

  it('reports a 409 restart as a concurrent-update conflict', async () => {
    getReplies = [{ body: PENDING }];
    postReplies = [{ body: { message: 'conflict' }, status: 409 }];
    stubFetch();
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: '重启生效' }));
    expect(await screen.findByText(/正在被其他操作更新/)).toBeInTheDocument();
  });

  it('reports a 404 restart as a missing worker', async () => {
    getReplies = [{ body: PENDING }];
    postReplies = [{ body: { message: 'worker not found' }, status: 404 }];
    stubFetch();
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: '重启生效' }));
    expect(await screen.findByText(/不存在或已被删除/)).toBeInTheDocument();
  });

  it('degrades a 404 config read to the upgrade placeholder', async () => {
    getReplies = [{ body: { message: 'not found' }, status: 404 }];
    stubFetch();
    renderPanel();

    expect(await screen.findByText(/Controller 升级后自动生效/)).toBeInTheDocument();
  });

  it('degrades 409 / 503 to neutral runtime and mode placeholders', async () => {
    getReplies = [{ body: { error: 'runtime_unknown' }, status: 409 }];
    stubFetch();
    const first = renderPanel();
    expect(await screen.findByText(/暂不支持配置生效检测/)).toBeInTheDocument();
    first.unmount();

    getReplies = [{ body: { error: 'embedded only' }, status: 503 }];
    stubFetch();
    renderPanel();
    expect(await screen.findByText(/需嵌入式模式/)).toBeInTheDocument();
  });
});
