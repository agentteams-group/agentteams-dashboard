import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkerCodingCliPanel } from './worker-coding-cli-panel';

const PROBE = {
  clis: [
    { id: 'qwen-code', installed: true, version: '0.25.0', auth_configured: true },
    { id: 'opencode', installed: false, auth_configured: false },
  ],
};

const SETTINGS = {
  model: { name: 'qwen3-coder' },
  api_key: { redacted: true, has_value: true },
};

type FetchResult = { status: number; body: unknown };
let results: FetchResult[] = [];
let calls: Array<{ url: string; method: string; body?: string }> = [];

function mockFetch(results_: FetchResult[]) {
  results = results_;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const idx = calls.length;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, method, body });
    const r = results[idx] ?? results[results.length - 1];
    const status = r ? r.status : 200;
    const payload = r ? r.body : PROBE;
    return {
      ok: status >= 200 && status < 400,
      status,
      json: async () => payload,
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
}

vi.setConfig({ testTimeout: 15_000 });

describe('B7 WorkerCodingCliPanel（#1360 消费）', () => {
  beforeEach(() => {
    calls = [];
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('① GET 200 → 渲染两行 CLI 状态', async () => {
    mockFetch([{ status: 200, body: PROBE }]);
    render(<WorkerCodingCliPanel workerName="w1" />);
    expect(await screen.findByText('编码 CLI（探测 / 安装 / 配置）')).toBeInTheDocument();
    expect(screen.getByText('Qwen Code')).toBeInTheDocument();
    expect(screen.getByText('OpenCode')).toBeInTheDocument();
    expect(screen.getByText('0.25.0')).toBeInTheDocument();
    expect(screen.getByText('未安装')).toBeInTheDocument();
    expect(calls[0].url).toBe('/api/agentteams/workers/w1/coding-cli');
  });

  it('② GET 404 → 占位文案，不含 PR 数字', async () => {
    mockFetch([{ status: 404, body: { error: 'not found' } }]);
    render(<WorkerCodingCliPanel workerName="w1" />);
    const banner = await screen.findByText(/编码 CLI 管理暂不可用/);
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).not.toMatch(/1360|#\d+/);
    expect(screen.queryByText('编码 CLI（探测 / 安装 / 配置）')).not.toBeInTheDocument();
  });

  it('③ 密钥留空且 has_value → PUT body 含 ***', async () => {
    mockFetch([
      { status: 200, body: PROBE },
      { status: 200, body: SETTINGS },
      { status: 200, body: { ok: true } },
      { status: 200, body: SETTINGS },
    ]);
    render(<WorkerCodingCliPanel workerName="w1" />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑 Qwen Code 配置' }));
    expect(await screen.findByText(/api_key/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT');
      expect(put).toBeTruthy();
      expect(JSON.parse(put!.body!)).toEqual({ api_key: '***' });
    });
  });

  it('④ 安装 202 → 轮询到 done 后再次探测', async () => {
    mockFetch([
      {
        status: 200,
        body: {
          clis: [
            { id: 'qwen-code', installed: false, auth_configured: false },
            { id: 'opencode', installed: false, auth_configured: false },
          ],
        },
      },
      { status: 202, body: { task_id: 't1' } },
      { status: 200, body: { task_id: 't1', status: 'done' } },
      { status: 200, body: PROBE },
    ]);
    render(<WorkerCodingCliPanel workerName="w1" />);
    fireEvent.click(await screen.findByRole('button', { name: '安装 Qwen Code' }));
    expect(await screen.findByText(/任务完成/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/qwen-code/install'))).toBe(
      true,
    );
    expect(calls.some((c) => c.url.endsWith('/qwen-code/install/t1'))).toBe(true);
    expect(calls.filter((c) => c.method === 'GET' && c.url.endsWith('/coding-cli')).length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('⑤ 安装 failed → 展示 stderr', async () => {
    mockFetch([
      {
        status: 200,
        body: {
          clis: [
            { id: 'qwen-code', installed: false },
            { id: 'opencode', installed: false },
          ],
        },
      },
      { status: 202, body: { task_id: 't2' } },
      { status: 200, body: { status: 'failed', stderr: 'npm ETARGET', exit_code: 1 } },
    ]);
    render(<WorkerCodingCliPanel workerName="w1" />);
    fireEvent.click(await screen.findByRole('button', { name: '安装 Qwen Code' }));
    expect(await screen.findByText('npm ETARGET')).toBeInTheDocument();
  });

  it('⑥ 503 → kube/embedded 文案', async () => {
    mockFetch([{ status: 503, body: { error: 'not embedded' } }]);
    render(<WorkerCodingCliPanel workerName="w1" />);
    expect(
      await screen.findByText(/当前部署模式不支持容器内安装与配置/),
    ).toBeInTheDocument();
  });

  it('⑦ 应用鸿蒙 preset → PUT 仅为 model.name，并出现需确认清单', async () => {
    mockFetch([
      { status: 200, body: PROBE },
      { status: 200, body: { ok: true } },
    ]);
    render(<WorkerCodingCliPanel workerName="w1" />);
    fireEvent.click(await screen.findByRole('button', { name: '鸿蒙 AI 开发' }));
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT');
      expect(put).toBeTruthy();
      expect(JSON.parse(put!.body!)).toEqual({ model: { name: 'qwen3.6-27b-fp8' } });
    });
    expect(await screen.findByText(/建议清单（需人工确认/)).toBeInTheDocument();
    expect(screen.getByText(/CLT 26.0.0/)).toBeInTheDocument();
  });

  it('⑧ auth_configured 且未安装 → 重装提示', async () => {
    mockFetch([
      {
        status: 200,
        body: {
          clis: [
            { id: 'qwen-code', installed: false, auth_configured: true },
            { id: 'opencode', installed: false, auth_configured: false },
          ],
        },
      },
    ]);
    render(<WorkerCodingCliPanel workerName="w1" />);
    expect(await screen.findByText(/容器重建后需重新安装/)).toBeInTheDocument();
  });

  it('⑨ POST 403（Leader 只读）→ 整面板转只读', async () => {
    mockFetch([
      {
        status: 200,
        body: {
          clis: [
            { id: 'qwen-code', installed: false },
            { id: 'opencode', installed: false },
          ],
        },
      },
      { status: 403, body: { error: 'forbidden' } },
    ]);
    render(<WorkerCodingCliPanel workerName="w1" />);
    fireEvent.click(await screen.findByRole('button', { name: '安装 Qwen Code' }));
    expect(await screen.findByText('当前角色仅可查看，不能修改编码 CLI')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '安装 Qwen Code' })).toBeDisabled();
  });

  it('⑩ POST 409 → 占用中说明', async () => {
    mockFetch([
      {
        status: 200,
        body: {
          clis: [
            { id: 'qwen-code', installed: false },
            { id: 'opencode', installed: false },
          ],
        },
      },
      { status: 409, body: { error: 'busy' } },
    ]);
    render(<WorkerCodingCliPanel workerName="w1" />);
    fireEvent.click(await screen.findByRole('button', { name: '安装 Qwen Code' }));
    expect(await screen.findByText('该 CLI 已有安装任务进行中')).toBeInTheDocument();
  });

  it('⑪ GET 502 → 容器不可达文案', async () => {
    mockFetch([{ status: 502, body: { error: 'unreachable' } }]);
    render(<WorkerCodingCliPanel workerName="w1" />);
    expect(await screen.findByText(/无法在该 Worker 容器内执行管理命令/)).toBeInTheDocument();
  });
});
