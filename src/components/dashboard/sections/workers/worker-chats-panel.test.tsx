import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import '@testing-library/jest-dom/vitest';
import { WorkerChatsPanel } from './worker-chats-panel';

const CHATS = [
  {
    id: 'c1',
    name: 'matrix:!room1:matrix.local',
    channel: 'matrix',
    updated_at: '2026-09-19T10:00:00Z',
    pinned: false,
    archived: false,
  },
];
const DETAIL = {
  messages: [
    { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello' }] },
    {
      id: 'm2',
      role: 'assistant',
      content: [
        { type: 'text', text: 'running…' },
        { type: 'tool_call', name: 'execute_shell_command' },
      ],
    },
  ],
  status: 'idle',
};

type FetchResult = { status: number; body: unknown };
let results: FetchResult[] = [];
let calls: Array<{ url: string; method: string }> = [];

function mockFetch(results_: FetchResult[]) {
  results = results_;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const idx = calls.length;
    calls.push({ url, method: (init?.method ?? 'GET').toUpperCase() });
    const r = results[idx] ?? results[0];
    const status = r ? r.status : 200;
    const payload = r ? r.body : CHATS;
    return {
      ok: status < 400,
      status,
      json: async () => payload,
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
}

describe('C WorkerChatsPanel（#1295 消费）', () => {
  beforeEach(() => {
    calls = [];
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('① GET 200 → 会话列表（名称/channel/时间）', async () => {
    mockFetch([{ status: 200, body: CHATS }]);
    render(<WorkerChatsPanel workerName="w1" />);
    expect(await screen.findByText('会话（只读 · Agent 上下文）')).toBeInTheDocument();
    expect(screen.getByText('matrix:!room1:matrix.local')).toBeInTheDocument();
    expect(calls[0].url).toBe('/api/agentteams/workers/w1/chats');
  });

  it('② GET 404（旧 Controller / L2 边界外）→ 占位横幅（不渲染空列表）', async () => {
    mockFetch([{ status: 404, body: { detail: 'Not Found' } }]);
    render(<WorkerChatsPanel workerName="w1" />);
    expect(await screen.findByText(/当前无可见会话/)).toBeInTheDocument();
    expect(screen.queryByText('会话（只读 · Agent 上下文）')).not.toBeInTheDocument();
  });

  it('③ GET 502（worker 不可达）→ 错误横幅 + 重试', async () => {
    mockFetch([{ status: 502, body: { error: 'worker unreachable' } }]);
    render(<WorkerChatsPanel workerName="w1" />);
    expect(await screen.findByText(/worker unreachable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();
  });

  it('④ 点开会话 → 详情含 Agent 上下文标注 + 消息（文本块 + 工具块）', async () => {
    mockFetch([
      { status: 200, body: CHATS },
      { status: 404, body: { detail: 'Not Found' } }, // status（旧 runtime 隐藏灯）
      { status: 200, body: DETAIL },
    ]);
    render(<WorkerChatsPanel workerName="w1" />);
    await screen.findByText('会话（只读 · Agent 上下文）');
    fireEvent.click(screen.getByRole('button', { name: /matrix:!room1/ }));
    expect(await screen.findByText(/Agent 上下文视图/)).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('🔧 execute_shell_command')).toBeInTheDocument();
  });

  it('⑤ status running → running 徽章', async () => {
    mockFetch([
      { status: 200, body: CHATS },
      { status: 200, body: { status: 'running' } },
      { status: 200, body: DETAIL },
    ]);
    render(<WorkerChatsPanel workerName="w1" />);
    await screen.findByText('会话（只读 · Agent 上下文）');
    fireEvent.click(screen.getByRole('button', { name: /matrix:!room1/ }));
    await screen.findByText('running');
  });

  it('⑥ status idle → idle 徽章', async () => {
    mockFetch([
      { status: 200, body: CHATS },
      { status: 200, body: { status: 'idle' } },
      { status: 200, body: DETAIL },
    ]);
    render(<WorkerChatsPanel workerName="w1" />);
    await screen.findByText('会话（只读 · Agent 上下文）');
    fireEvent.click(screen.getByRole('button', { name: /matrix:!room1/ }));
    await screen.findByText('idle');
  });

  it('⑦ 详情 404（chat 不存在 / L2 边界外）→ soft hidden 占位（不显示红 banner）', async () => {
    mockFetch([
      { status: 200, body: CHATS },
      { status: 404, body: { detail: 'Not Found' } }, // status
      { status: 404, body: { detail: 'Chat not found: c1' } },
    ]);
    render(<WorkerChatsPanel workerName="w1" />);
    await screen.findByText('会话（只读 · Agent 上下文）');
    fireEvent.click(screen.getByRole('button', { name: /matrix:!room1/ }));
    expect(await screen.findByText(/该会话不可见/)).toBeInTheDocument();
    expect(screen.queryByText(/详情加载失败/)).not.toBeInTheDocument();
  });

  it('⑦b 详情 403（无权限）→ 同 404 走 hidden 占位', async () => {
    mockFetch([
      { status: 200, body: CHATS },
      { status: 404, body: { detail: 'Not Found' } }, // status
      { status: 403, body: { detail: 'forbidden' } },
    ]);
    render(<WorkerChatsPanel workerName="w1" />);
    await screen.findByText('会话（只读 · Agent 上下文）');
    fireEvent.click(screen.getByRole('button', { name: /matrix:!room1/ }));
    expect(await screen.findByText(/该会话不可见/)).toBeInTheDocument();
    expect(screen.queryByText(/详情加载失败/)).not.toBeInTheDocument();
  });

  it('⑧ 返回列表按钮可用', async () => {
    mockFetch([
      { status: 200, body: CHATS },
      { status: 404, body: { detail: 'Not Found' } },
      { status: 200, body: DETAIL },
    ]);
    render(<WorkerChatsPanel workerName="w1" />);
    await screen.findByText('会话（只读 · Agent 上下文）');
    fireEvent.click(screen.getByRole('button', { name: /matrix:!room1/ }));
    await screen.findByText(/Agent 上下文视图/);
    fireEvent.click(screen.getByRole('button', { name: /返回列表/ }));
    expect(await screen.findByText('会话（只读 · Agent 上下文）')).toBeInTheDocument();
  });
});
