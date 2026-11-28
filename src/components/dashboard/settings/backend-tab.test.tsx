'use client';

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendTab } from './backend-tab';

// 设置 → 后端 tab：逐槽位（内网/外网）地址 + 网关凭据（Basic/Bearer）。
// 关键契约：GET entries 回填认证方式/用户名（秘密只回 '***'）；保存时秘密
// 留空 → 发 '***' 保持旧值、绝不把 {url, auth} 降级成纯 URL；切回服务自身
// 认证 → 纯 URL（清除）；「测试」必须带表单里的草稿凭据。

const SAVE_URL = '/api/agentteams/setup/backends/';
const TEST_URL = '/api/agentteams/setup/backends/test/';

interface RecordedCall {
  url: string;
  method: string;
  body?: unknown;
}

let calls: RecordedCall[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 已存凭据（秘密脱敏为 '***'）的后端配置。 */
function savedState() {
  return {
    configured: true,
    backends: {
      controller: { configured: true, candidates: ['http://int:8090', 'http://ext:8090'] },
    },
    entries: {
      controller: {
        internal: { url: 'http://int:8090', auth: { type: 'basic', username: 'gw', password: '***' } },
        external: { url: 'http://ext:8090', auth: { type: 'bearer', token: '***' } },
      },
    },
    effective: {},
    embedded: { defaults: {}, healthy: null },
  };
}

function installFetch(state: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes(TEST_URL)) return json({ ok: true, results: { controller: [] } });
    if (method === 'POST') return json({ ok: true, effective: {}, switched: {} });
    return json(state);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BackendTab />
    </QueryClientProvider>,
  );
}

function savedBody() {
  const call = calls.find((c) => c.method === 'POST' && c.url.includes(SAVE_URL));
  expect(call).toBeTruthy();
  return call!.body as { backends: Record<string, unknown> };
}

function testedBody() {
  const call = calls.find((c) => c.method === 'POST' && c.url.includes(TEST_URL));
  expect(call).toBeTruthy();
  return call!.body as { backends: Record<string, unknown> };
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // Radix Select 打开时会对选中项调用 scrollIntoView（jsdom 未实现）。
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BackendTab（设置 → 后端）', () => {
  it('回填已存的 Basic / Bearer 凭据：认证方式 + 用户名，秘密只显示占位', async () => {
    installFetch(savedState());
    renderTab();

    const internalUrl = (await screen.findByLabelText('AgentTeams Controller 内网 地址')) as HTMLInputElement;
    expect(internalUrl.value).toBe('http://int:8090');
    expect((screen.getByLabelText('AgentTeams Controller 内网 用户名') as HTMLInputElement).value).toBe('gw');

    const password = screen.getByLabelText('AgentTeams Controller 内网 密码') as HTMLInputElement;
    expect(password.value).toBe('');
    expect(password.placeholder).toBe('已保存 · 留空保持');

    expect((screen.getByLabelText('AgentTeams Controller 外网 地址') as HTMLInputElement).value).toBe(
      'http://ext:8090',
    );
    const token = screen.getByLabelText('AgentTeams Controller 外网 Token') as HTMLInputElement;
    expect(token.value).toBe('');
    expect(token.placeholder).toBe('已保存 · 留空保持');

    expect(
      screen.getByRole('combobox', { name: 'AgentTeams Controller 内网 认证方式' }).textContent,
    ).toContain('Basic');
    expect(
      screen.getByRole('combobox', { name: 'AgentTeams Controller 外网 认证方式' }).textContent,
    ).toContain('Bearer');
  });

  it('保存时秘密留空 → 发 *** 保持旧值，对象形态不降级为字符串；保存后回填仍为已存', async () => {
    installFetch(savedState());
    renderTab();
    await screen.findByLabelText('AgentTeams Controller 内网 地址');

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes(SAVE_URL))).toBe(true));

    const backends = savedBody().backends as Record<string, Record<string, unknown>>;
    expect(backends.controller.internal).toEqual({
      url: 'http://int:8090',
      auth: { type: 'basic', username: 'gw', password: '***' },
    });
    expect(backends.controller.external).toEqual({
      url: 'http://ext:8090',
      auth: { type: 'bearer', token: '***' },
    });
    expect(backends.controller).not.toEqual({ internal: 'http://int:8090', external: 'http://ext:8090' });

    // 保存后重新 GET entries 回填：凭据仍以 stored 形态存在。
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThanOrEqual(2));
    expect((screen.getByLabelText('AgentTeams Controller 内网 密码') as HTMLInputElement).placeholder).toBe(
      '已保存 · 留空保持',
    );
  });

  it('切回「服务自身认证」→ 该槽位保存为纯 URL（清除凭据），另一槽位凭据不受影响', async () => {
    installFetch(savedState());
    renderTab();
    await screen.findByLabelText('AgentTeams Controller 内网 地址');

    fireEvent.keyDown(
      screen.getByRole('combobox', { name: 'AgentTeams Controller 内网 认证方式' }),
      { key: 'Enter' },
    );
    fireEvent.click(await screen.findByRole('option', { name: '服务自身认证' }));

    expect(screen.queryByLabelText('AgentTeams Controller 内网 用户名')).toBeNull();
    expect(screen.queryByLabelText('AgentTeams Controller 内网 密码')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes(SAVE_URL))).toBe(true));

    const backends = savedBody().backends as Record<string, Record<string, unknown>>;
    expect(backends.controller.internal).toBe('http://int:8090');
    expect(backends.controller.external).toEqual({
      url: 'http://ext:8090',
      auth: { type: 'bearer', token: '***' },
    });
  });

  it('「测试」带草稿凭据：新填密码随请求发送，未改的槽位发 *** 保持', async () => {
    installFetch(savedState());
    renderTab();
    const password = (await screen.findByLabelText('AgentTeams Controller 内网 密码')) as HTMLInputElement;

    fireEvent.change(password, { target: { value: 'draft-pass' } });
    fireEvent.click(screen.getByRole('button', { name: '测试 AgentTeams Controller' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes(TEST_URL))).toBe(true));

    const backends = testedBody().backends as Record<string, Record<string, unknown>>;
    expect(backends.controller.internal).toEqual({
      url: 'http://int:8090',
      auth: { type: 'basic', username: 'gw', password: 'draft-pass' },
    });
    expect(backends.controller.external).toEqual({
      url: 'http://ext:8090',
      auth: { type: 'bearer', token: '***' },
    });
  });

  it('初次 GET 失败可重试，且不会永久停留在加载态', async () => {
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(TEST_URL)) return json({ results: { controller: [] } });
      if (init?.method === 'POST') return json({ ok: true });
      reads += 1;
      return reads === 1 ? json({}, 503) : json(savedState());
    }));
    renderTab();
    expect(await screen.findByText('后端配置加载失败')).toBeInTheDocument();
    expect(screen.queryByText('加载后端配置…')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
    expect(await screen.findByLabelText('AgentTeams Controller 内网 地址')).toHaveValue('http://int:8090');
  });

  it('测试失败不会显示已保存，也不会清除草稿', async () => {
    const fetchMock = installFetch(savedState());
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes(TEST_URL)) return json({}, 502);
      if (init?.method === 'POST') return json({ ok: true });
      return json(savedState());
    });
    renderTab();
    const password = await screen.findByLabelText('AgentTeams Controller 内网 密码');
    fireEvent.change(password, { target: { value: 'keep-this-draft' } });
    fireEvent.click(screen.getByRole('button', { name: '测试 AgentTeams Controller' }));
    expect(await screen.findByText('测试失败（HTTP 502）')).toBeInTheDocument();
    expect(screen.queryByText(/已保存，立即生效/)).not.toBeInTheDocument();
    expect(password).toHaveValue('keep-this-draft');
  });

  it('保存成功但回读失败时保留已保存状态和草稿，并可单独重试回读', async () => {
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(TEST_URL)) return json({ results: { controller: [] } });
      if (init?.method === 'POST') return json({ ok: true });
      reads += 1;
      return reads === 1 ? json(savedState()) : json({}, 500);
    }));
    renderTab();
    const password = await screen.findByLabelText('AgentTeams Controller 内网 密码');
    fireEvent.change(password, { target: { value: 'keep-this-draft' } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    expect(await screen.findByText(/配置已保存，但暂时无法确认/)).toBeInTheDocument();
    expect(screen.getByText(/已保存，立即生效/)).toBeInTheDocument();
    expect(password).toHaveValue('keep-this-draft');
    expect(screen.queryByText('保存请求失败')).not.toBeInTheDocument();
  });

  it('保存 POST 失败不会自动测试或显示已保存', async () => {
    const fetchMock = installFetch(savedState());
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes(TEST_URL)) return json({ results: { controller: [] } });
      if (init?.method === 'POST') return json({ error: 'save rejected' }, 500);
      return json(savedState());
    });
    renderTab();
    await screen.findByLabelText('AgentTeams Controller 内网 地址');
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    expect(await screen.findByText('save rejected')).toBeInTheDocument();
    expect(screen.queryByText(/已保存，立即生效/)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes(TEST_URL))).toBe(false);
  });

  it('选了 Basic 但既没填密码也没已存凭据 → 拦住保存并给可读提示（不静默降级成纯 URL）', async () => {
    installFetch({
      configured: true,
      backends: { controller: { configured: true, candidates: [] } },
      entries: {},
      effective: {},
      embedded: { defaults: {}, healthy: null },
    });
    renderTab();

    fireEvent.change(await screen.findByLabelText('AgentTeams Controller 内网 地址'), {
      target: { value: 'http://int:8090' },
    });
    fireEvent.keyDown(
      screen.getByRole('combobox', { name: 'AgentTeams Controller 内网 认证方式' }),
      { key: 'Enter' },
    );
    fireEvent.click(await screen.findByRole('option', { name: 'Basic' }));
    fireEvent.change(screen.getByLabelText('AgentTeams Controller 内网 用户名'), {
      target: { value: 'gw' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    expect(await screen.findByText(/请填写网关密码/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.includes(SAVE_URL))).toBe(false);
  });
});
