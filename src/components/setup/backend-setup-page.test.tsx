'use client';

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSetupPage } from './backend-setup-page';

// 设置页的两个实测缺陷（2026-11-07）：
// 1) 保存成功后离开本页，重开 ?setup=1 地址全空 —— setup token 只在内存
//    state 里，而 PR-91 之后匿名 GET 不返回已存拓扑 → 必须把 token 留在
//    sessionStorage 并在挂载时读回来做带 Authorization 的重取。
// 2) 草稿 Basic 凭据不进探测通道 → 门后地址测试永远 401（后端测试另有
//    route.test.ts 覆盖；这里只锁前端是否把凭据一起送出去）。
const TOKEN_KEY = 'agentteams.setupToken';

const GATE_SHAPE = {
  configured: true,
  setupTokenRequired: true,
  embedded: { defaults: {}, healthy: null },
};

const AUTHORIZED_SHAPE = {
  configured: true,
  setupTokenRequired: true,
  backends: {
    controller: { configured: true, candidates: ['http://10.0.0.5:8090'] },
  },
  entries: {
    controller: { internal: 'http://10.0.0.5:8090' },
  },
  effective: { controller: 'http://10.0.0.5:8090' },
  embedded: { defaults: {}, healthy: null },
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function authorizationOf(init: RequestInit | undefined): string | null {
  return new Headers(init?.headers).get('authorization');
}

const TOKEN_PLACEHOLDER = '见服务器日志或 DASHBOARD_SETUP_TOKEN';

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe('BackendSetupPage: setup token 在会话内记住（重开回填）', () => {
  it('sessionStorage 有 token 时挂载会用 Authorization 重新 GET 并回填已存地址', async () => {
    window.sessionStorage.setItem(TOKEN_KEY, 'tok-abc');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return authorizationOf(init) === 'Bearer tok-abc'
        ? jsonResponse(AUTHORIZED_SHAPE)
        : jsonResponse(GATE_SHAPE);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BackendSetupPage reconfigure onDone={() => {}} />);

    await screen.findByRole('button', { name: /保存并进入登录/ });
    // 匿名首取只回门形状 → 地址为空；token 驱动的重取把已存地址填回来。
    expect(await screen.findByDisplayValue('http://10.0.0.5:8090', undefined, { timeout: 3000 }))
      .toBeInTheDocument();
    const authorized = fetchMock.mock.calls.filter(
      ([, init]) => authorizationOf(init as RequestInit | undefined) === 'Bearer tok-abc',
    );
    expect(authorized.length).toBeGreaterThan(0);
  });

  it('保存成功后把 setup token 写入 sessionStorage（下次重开才有得读）', async () => {
    const onDone = vi.fn();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ ok: true });
      return jsonResponse(GATE_SHAPE);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BackendSetupPage onDone={onDone} />);

    const tokenInput = await screen.findByPlaceholderText(TOKEN_PLACEHOLDER);
    fireEvent.change(tokenInput, { target: { value: 'tok-save' } });
    fireEvent.click(screen.getByRole('button', { name: /保存并进入登录/ }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBe('tok-save');
  });

  it('保存返回 invalid-token 时删除 sessionStorage 里的 token', async () => {
    window.sessionStorage.setItem(TOKEN_KEY, 'tok-stale');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ ok: false, error: 'invalid-token' }, 403);
      return jsonResponse(AUTHORIZED_SHAPE);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BackendSetupPage reconfigure onDone={() => {}} />);

    // 带 token 的 GET 成功 → 已存地址回填、token 仍留着
    await screen.findByDisplayValue('http://10.0.0.5:8090', undefined, { timeout: 3000 });
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBe('tok-stale');

    fireEvent.click(screen.getByRole('button', { name: /保存并进入登录/ }));
    await screen.findByText(/首次启动 token 不正确/);
    await waitFor(() => expect(window.sessionStorage.getItem(TOKEN_KEY)).toBeNull());
  });
});

describe('BackendSetupPage: 草稿凭据参与「测试」', () => {
  it('点「测试」时把表单里刚填的 Basic 凭据一起送出（否则门后地址永远 401）', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return jsonResponse({
          ok: true,
          results: {
            controller: [
              { url: 'http://10.0.0.5:8090', ok: true, httpOk: true, ms: 12, detail: 'HTTP 200，正常' },
            ],
          },
        });
      }
      return jsonResponse(GATE_SHAPE);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BackendSetupPage onDone={() => {}} />);

    const addrInput = (await screen.findAllByPlaceholderText('host:port（自动识别 https / http）'))[0];
    fireEvent.change(addrInput, { target: { value: 'http://10.0.0.5:8090' } });
    fireEvent.change(screen.getAllByLabelText('内网地址认证方式')[0], {
      target: { value: 'basic' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('用户名')[0], { target: { value: 'ops' } });
    fireEvent.change(screen.getAllByPlaceholderText('密码')[0], { target: { value: 's3cret' } });

    fireEvent.click(screen.getAllByRole('button', { name: '测试' })[0]);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(String((post![1] as RequestInit).body)) as {
        backends: Record<string, { internal?: unknown }>;
      };
      expect(body.backends.controller.internal).toEqual({
        url: 'http://10.0.0.5:8090',
        auth: { type: 'basic', username: 'ops', password: 's3cret' },
      });
    });
  });
});
