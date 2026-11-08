import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './login-page';

const { setMatrixAuth } = vi.hoisted(() => ({ setMatrixAuth: vi.fn() }));

vi.mock('@/lib/matrix-store', () => ({
  useMatrixStore: (selector: (_s: { setMatrixAuth: typeof setMatrixAuth }) => unknown) =>
    selector({ setMatrixAuth }),
}));

const TOKEN_ENTRY = '仅用 Controller 管理员 token 登录';

function mockLoginResponse(status: number, body: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function openTokenEntry() {
  fireEvent.click(screen.getByRole('button', { name: TOKEN_ENTRY }));
  return screen.getByPlaceholderText('Controller 管理员 token');
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LoginPage Controller token-only login', () => {
  it('keeps the token entry collapsed until expanded', () => {
    render(<LoginPage />);

    expect(screen.queryByPlaceholderText('Controller 管理员 token')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Token 登录' })).toBeNull();

    const tokenInput = openTokenEntry();
    expect(tokenInput).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Token 登录' })).toBeInTheDocument();
  });

  it('submits only the controllerToken and runs the success callback', async () => {
    const onLoginSuccess = vi.fn();
    const fetchMock = mockLoginResponse(200, {
      success: true,
      user: { username: 'controller-admin', level: 3 },
      mode: 'controller-token',
    });
    render(<LoginPage onLoginSuccess={onLoginSuccess} />);

    const tokenInput = openTokenEntry();
    // The main username/password form stays untouched.
    fireEvent.change(tokenInput, { target: { value: 'admin-token-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Token 登录' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/login/');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ controllerToken: 'admin-token-1' });

    await waitFor(() => expect(onLoginSuccess).toHaveBeenCalledOnce());
    // No Matrix auto-login payload on this track.
    expect(setMatrixAuth).not.toHaveBeenCalled();
  });

  it('shows the backend error text when the token is rejected', async () => {
    const onLoginSuccess = vi.fn();
    mockLoginResponse(401, { success: false, error: 'Controller 管理员 token 无效' });
    render(<LoginPage onLoginSuccess={onLoginSuccess} />);

    const tokenInput = openTokenEntry();
    fireEvent.change(tokenInput, { target: { value: 'bad-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Token 登录' }));

    expect(await screen.findByText('Controller 管理员 token 无效')).toBeInTheDocument();
    expect(onLoginSuccess).not.toHaveBeenCalled();
  });

  it('keeps the password form path unchanged when a token is not used', async () => {
    const fetchMock = mockLoginResponse(200, {
      success: true,
      user: { username: 'admin', level: 3 },
      mode: 'higress',
    });
    render(<LoginPage onLoginSuccess={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('admin'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /登录工作区/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ username: 'admin', password: 'password' });
  });

  it('shows the actionable data-plane 401 notice (and nothing else auto-runs)', () => {
    const fetchMock = mockLoginResponse(200, { success: true });
    render(<LoginPage dataPlaneRejected />);

    expect(
      screen.getByText('登录成功但数据面凭据被拒绝：请检查 Controller 服务账号 token / 网关认证，或使用 Controller token 登录'),
    ).toBeInTheDocument();
    // Never retries by itself: no request is issued on mount.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
