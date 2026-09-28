import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkerRuntimeConfigPanel } from './worker-runtime-config-panel';

const CONFIG = {
  max_iters: 20,
  max_input_tokens: 160000,
  compaction_threshold: 0.8,
  loop_config: { loop_detection: { enabled: true } },
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
    const r = results[idx] ?? results[0];
    const status = r ? r.status : 200;
    const payload = r ? r.body : CONFIG;
    return {
      ok: status < 400,
      status,
      json: async () => payload,
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
}

// A1 (2026-09-28): passes in isolation; under full-suite parallel load the
// default 5s budget occasionally trips on render + waitFor churn. Loosen the
// budget — assertions and waitFor intervals are unchanged.
vi.setConfig({ testTimeout: 15_000 });

describe('B5 WorkerRuntimeConfigPanel（#1231 消费）', () => {
  beforeEach(() => {
    calls = [];
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('① GET 200 → 字段载入（max_iters=20 / 160000 / 0.8）', async () => {
    mockFetch([{ status: 200, body: CONFIG }]);
    render(<WorkerRuntimeConfigPanel workerName="w1" />);
    expect(await screen.findByText('Runtime 配置（字段级保存）')).toBeInTheDocument();
    expect(screen.getByDisplayValue('20')).toBeInTheDocument();
    expect(screen.getByDisplayValue('160000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('0.8')).toBeInTheDocument();
  });

  it('② GET 404（#1231 未合并）→ 占位横幅不报错', async () => {
    mockFetch([{ status: 404, body: { error: 'not found' } }]);
    render(<WorkerRuntimeConfigPanel workerName="w1" />);
    expect(await screen.findByText(/当前 Controller 版本未提供/)).toBeInTheDocument();
    expect(screen.queryByText('Runtime 配置（字段级保存）')).not.toBeInTheDocument();
  });

  it('③ 只改 max_iters → PUT body 仅含 {max_iters:30}（字段级 diff）+ loop 提示', async () => {
    mockFetch([
      { status: 200, body: CONFIG },
      { status: 200, body: { ok: true } },
    ]);
    render(<WorkerRuntimeConfigPanel workerName="w1" />);
    await screen.findByText('Runtime 配置（字段级保存）');
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /保存改动/ }));
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT');
      expect(put).toBeTruthy();
      expect(JSON.parse(put!.body!)).toEqual({ max_iters: 30 });
    });
    expect(await screen.findByText(/loop 字段改动将通知团队 Leader/)).toBeInTheDocument();
  });

  it('④ 无改动 → 保存按钮禁用（不发空 PUT）', async () => {
    mockFetch([{ status: 200, body: CONFIG }]);
    render(<WorkerRuntimeConfigPanel workerName="w1" />);
    await screen.findByText('Runtime 配置（字段级保存）');
    const btn = screen.getByRole('button', { name: /保存改动/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(calls.filter((c) => c.method === 'PUT').length).toBe(0);
  });

  it('⑤ loop_config 整块替换 → diff 含解析后的对象', async () => {
    mockFetch([
      { status: 200, body: CONFIG },
      { status: 200, body: { ok: true } },
    ]);
    render(<WorkerRuntimeConfigPanel workerName="w1" />);
    await screen.findByText('Runtime 配置（字段级保存）');
    fireEvent.click(screen.getByText('loop_config（整块替换）'));
    // 多行值不依赖 findByDisplayValue（whitespace 归一化不稳），直查 DOM
    const textarea = await waitFor(
      () => {
        const ta = document.querySelector('textarea');
        if (!ta) throw new Error('no textarea yet');
        return ta as HTMLTextAreaElement;
      },
      { timeout: 2000 },
    );
    expect(textarea.value).toBe(JSON.stringify(CONFIG.loop_config, null, 2));
    fireEvent.change(textarea, {
      target: { value: JSON.stringify({ loop_detection: { enabled: false } }) },
    });
    fireEvent.click(screen.getByRole('button', { name: /保存改动/ }));
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT');
      expect(put).toBeTruthy();
      expect(JSON.parse(put!.body!)).toEqual({
        loop_config: { loop_detection: { enabled: false } },
      });
    });
  });

  it('⑥ PUT 409 → 「配置被锁定」提示', async () => {
    mockFetch([
      { status: 200, body: CONFIG },
      { status: 409, body: { error: 'config locked' } },
    ]);
    render(<WorkerRuntimeConfigPanel workerName="w1" />);
    await screen.findByText('Runtime 配置（字段级保存）');
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: /保存改动/ }));
    expect(await screen.findByText(/配置被锁定（409）/)).toBeInTheDocument();
  });

  it('⑦ 非法输入（max_iters=0）→ 内联校验错误 + 保存禁用', async () => {
    mockFetch([{ status: 200, body: CONFIG }]);
    render(<WorkerRuntimeConfigPanel workerName="w1" />);
    await screen.findByText('Runtime 配置（字段级保存）');
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '0' } });
    expect(screen.getByText('max_iters 须为正整数')).toBeInTheDocument();
    expect((screen.getByRole('button', { name: /保存改动/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
