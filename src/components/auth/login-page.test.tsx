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
const ADMIN_ENTRY = 'L1 账号管理员验证（旧 Controller 需要）';
const ADMIN_COLLAPSE = '收起 L1 账号管理员验证';
const ADMIN_HINT =
  '旧 Controller 上使用 Matrix 账号登录 L1 时，必须填写这里的 Console 管理员账号/密码；admin 账号本身不需要重复填写。';

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

function openAdminEntry() {
  return screen.getByPlaceholderText('管理员账号');
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LoginPage Controller token-only login', () => {
  it('prefills admin and focuses the password for a fresh local install', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText('用户名')).toHaveValue('admin');
    expect(screen.getByLabelText('密码')).toHaveFocus();
  });
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
      screen.getByText('登录凭据被 Controller 拒绝，请重新登录。若仍无法访问，请联系管理员检查 Human 权限和后端配置。'),
    ).toBeInTheDocument();
    // Never retries by itself: no request is issued on mount.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('LoginPage L1 admin verification', () => {
  it('shows the admin verification section expanded by default', () => {
    render(<LoginPage />);

    // The entry must be obvious: the fields are visible without a click and
    // the section can still be collapsed.
    expect(screen.getByPlaceholderText('管理员账号')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('管理员密码')).toBeInTheDocument();
    expect(screen.getByText(ADMIN_HINT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ADMIN_COLLAPSE })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: ADMIN_COLLAPSE }));
    expect(screen.queryByPlaceholderText('管理员账号')).toBeNull();
    expect(screen.queryByPlaceholderText('管理员密码')).toBeNull();
    expect(screen.getByRole('button', { name: ADMIN_ENTRY })).toBeInTheDocument();
  });

  it('sends adminUsername/adminPassword when both are filled', async () => {
    const fetchMock = mockLoginResponse(200, {
      success: true,
      user: { username: 'luo', level: 3 },
      mode: 'matrix',
    });
    render(<LoginPage onLoginSuccess={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('admin'), { target: { value: 'luo' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'luo-pass' } });
    fireEvent.change(openAdminEntry(), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText('管理员密码'), { target: { value: 'admin-pass' } });
    fireEvent.click(screen.getByRole('button', { name: /登录工作区/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      username: 'luo',
      password: 'luo-pass',
      adminUsername: 'admin',
      adminPassword: 'admin-pass',
    });
  });

  it('keeps the body unchanged while the admin fields are empty', async () => {
    const fetchMock = mockLoginResponse(200, {
      success: true,
      user: { username: 'admin', level: 3 },
      mode: 'higress',
    });
    render(<LoginPage onLoginSuccess={vi.fn()} />);

    // The section is expanded by default; leaving it empty must not add keys.
    expect(screen.getByPlaceholderText('管理员账号')).toHaveValue('');
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /登录工作区/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ username: 'admin', password: 'password' });
  });

  it('omits the admin fields when only one side is filled', async () => {
    const fetchMock = mockLoginResponse(200, {
      success: true,
      user: { username: 'admin', level: 3 },
      mode: 'higress',
    });
    render(<LoginPage onLoginSuccess={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password' } });
    fireEvent.change(openAdminEntry(), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: /登录工作区/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ username: 'admin', password: 'password' });
  });
});
