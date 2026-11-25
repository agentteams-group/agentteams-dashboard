import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkerCheckpointsCard } from './worker-checkpoints-card';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WorkerCheckpointsCard', () => {
  it('degrades to 不支持 on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(404, {})));
    render(<WorkerCheckpointsCard workerName="w1" />);
    expect(await screen.findByText(/不支持检查点读取/)).toBeInTheDocument();
  });

  it('degrades to 不可用 on 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(502, { error: 'requires QwenPaw 2.1' })));
    render(<WorkerCheckpointsCard workerName="w1" />);
    expect(await screen.findByText(/检查点暂不可用/)).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/status')) return json(200, { auto_enabled: true, has_checkpoints: false, workspace_dir: '/w' });
      return json(200, { nodes: [], summary: { total: 0, auto: 0, snapshots: 0, safety: 0, heads: 0 } });
    }));
    render(<WorkerCheckpointsCard workerName="w1" />);
    expect(await screen.findByText(/暂无检查点/)).toBeInTheDocument();
  });

  it('lists checkpoint nodes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/status')) return json(200, { auto_enabled: true, has_checkpoints: true, workspace_dir: '/w' });
      return json(200, {
        nodes: [{ ref: 'r1', kind: 'auto', name: 'a', subject: '处理工单', timestamp_ms: 1_700_000_000_000, is_head: true }],
        summary: { total: 1, auto: 1, snapshots: 0, safety: 0, heads: 1 },
      });
    }));
    render(<WorkerCheckpointsCard workerName="w1" />);
    expect(await screen.findByText('处理工单')).toBeInTheDocument();
    expect(screen.getByText('HEAD')).toBeInTheDocument();
  });
});
