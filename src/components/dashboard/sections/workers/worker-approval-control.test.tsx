import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkerApprovalControl } from './worker-approval-control';

// 工具执行安全卡片四档（插件同款 ToolExecutionLevelCard 样式）行为测试：
// 四卡渲染 / 404 整节隐藏 / L2 403 琥珀提示 / 选卡→应用→成功更新 / 写 403 报错。

function mockFetchJson(responses: Array<{ status: number; body: unknown; match?: (_url: string, _method: string) => boolean }>) {
  const calls: Array<{ url: string; method: string }> = [];
  let i = 0;
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method });
    while (i < responses.length) {
      const r = responses[i];
      const matcher = r.match ?? (() => true);
      i += 1;
      if (matcher(url, method)) {
        return new Response(JSON.stringify(r.body), {
          status: r.status,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    throw new Error(`未预期的 fetch：${method} ${url}`);
  });
  return { fn, calls };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WorkerApprovalControl（工具执行安全）', () => {
  it('渲染插件同款四档卡片（严格/智能/自动/关闭）+ 当前模式', async () => {
    const { fn } = mockFetchJson([
      { status: 200, body: { approval_level: 'AUTO', source: 'controller' } },
    ]);
    vi.stubGlobal('fetch', fn);
    const { container } = render(<WorkerApprovalControl workerName="w1" />);
    expect(await screen.findByText('工具执行安全')).toBeTruthy();
    expect(screen.getByText('严格模式')).toBeTruthy();
    expect(screen.getByText('智能模式')).toBeTruthy();
    expect(screen.getByText('自动模式')).toBeTruthy();
    expect(screen.getByText('关闭模式')).toBeTruthy();
    expect(screen.getByText(/当前模式: 自动（AUTO）/)).toBeTruthy();
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(5); // 4 卡 + 标题图标
  });

  it('404 → 整节隐藏（Worker 不存在/两平面均不可用）', async () => {
    vi.stubGlobal('fetch', mockFetchJson([{ status: 404, body: { error: 'no such worker' } }]).fn);
    const { container } = render(<WorkerApprovalControl workerName="ghost" />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('403 → L2 琥珀提示（不报错、不隐藏）', async () => {
    vi.stubGlobal('fetch', mockFetchJson([{ status: 403, body: { error: 'l2', l2_hint: 'L2 账号无权限读取' } }]).fn);
    render(<WorkerApprovalControl workerName="w2" />);
    expect(await screen.findByText(/L2 账号无权限读取/)).toBeTruthy();
    expect(screen.queryByText('严格模式')).toBeNull(); // 读不到 → 不渲染卡片
  });

  it('选卡→出现应用按钮→PUT 成功→当前模式更新', async () => {
    const { fn, calls } = mockFetchJson([
      { status: 200, body: { approval_level: 'AUTO', source: 'controller' } },
      { status: 200, body: { ok: true, level: 'STRICT', verified: 'STRICT', source: 'controller' } },
    ]);
    vi.stubGlobal('fetch', fn);
    render(<WorkerApprovalControl workerName="w3" />);
    fireEvent.click(await screen.findByText('严格模式'));
    const applyBtn = await screen.findByRole('button', { name: /应用: 严格模式/ });
    fireEvent.click(applyBtn);
    await waitFor(() => expect(screen.getByText(/当前模式: 严格（STRICT）/)).toBeTruthy());
    expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/workers/w3/approval'))).toBe(true);
  });

  it('写 403（L2 设 OFF / team leader）→ 错误文案', async () => {
    const { fn } = mockFetchJson([
      { status: 200, body: { approval_level: 'AUTO', source: 'controller' } },
      { status: 403, body: { error: '无权限设置该级别（L2 不能设 OFF；team leader 只读）' } },
    ]);
    vi.stubGlobal('fetch', fn);
    render(<WorkerApprovalControl workerName="w4" />);
    fireEvent.click(await screen.findByText('关闭模式'));
    fireEvent.click(await screen.findByRole('button', { name: /应用: 关闭模式/ }));
    expect(await screen.findByText(/无权限设置该级别/)).toBeTruthy();
  });
});
