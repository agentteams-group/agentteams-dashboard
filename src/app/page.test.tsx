import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import Home from './page';

const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

vi.mock('@/components/dashboard/agent-teams-dashboard', () => ({ AgentTeamsDashboard: () => <div>dashboard-ready</div> }));
vi.mock('@/components/auth/login-page', () => ({ LoginPage: () => <div>login-ready</div> }));
vi.mock('@/components/auth/stateless-login-page', () => ({ StatelessLoginPage: () => <div>stateless-login-ready</div> }));
vi.mock('@/components/setup/backend-setup-page', () => ({ BackendSetupPage: () => <div>backend-setup-ready</div> }));
vi.mock('@/components/setup/setup-wizard', () => ({ SetupWizard: () => <div>setup-wizard-ready</div> }));
vi.mock('@/lib/query-provider', () => ({ QueryProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/lib/search-context', () => ({ SearchProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/lib/agentteams-store', () => ({ useAgentTeamsStore: { getState: () => ({ setUserLevel: vi.fn(), setSessionUser: vi.fn() }) } }));
vi.mock('@/components/theme/theme-provider', () => ({ ThemeProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

const mode = { authMode: 'stateful', defaultHomeservers: [] };
const authenticated = { authenticated: true, username: 'admin', level: 3 };
const configured = { configured: true, setupTokenRequired: true };
const setupComplete = { setupRequired: false };

function installFetch(handler: (_url: string) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('startup probe state machine', () => {
  it.each([
    ['部署模式', '/mode', mode],
    ['登录会话', '/session', authenticated],
    ['初始化状态', '/status/', setupComplete],
  ])('does not render the dashboard when the %s probe fails', async (_label, suffix, _fallback) => {
    installFetch((url) => {
      if (url.includes(suffix)) return json({}, 503);
      if (url.includes('/mode')) return json(mode);
      if (url.includes('/session')) return json(authenticated);
      return json(setupComplete);
    });
    render(<Home />);
    expect(await screen.findByRole('alert')).toHaveTextContent('探测失败');
    expect(screen.queryByText('dashboard-ready')).not.toBeInTheDocument();
  });

  it('labels a failed pre-setup probe separately from the session and retries successfully', async () => {
    let failPreSetup = true;
    installFetch((url) => {
      if (url.includes('/mode')) return json(mode);
      if (url.includes('/session')) return json({ authenticated: false });
      if (url.includes('/setup/backends')) return failPreSetup ? json({}, 500) : json(configured);
      return json(setupComplete);
    });
    render(<Home />);
    expect(await screen.findByRole('alert')).toHaveTextContent('后端配置状态探测失败');
    expect(screen.queryByText('login-ready')).not.toBeInTheDocument();
    failPreSetup = false;
    fireEvent.click(screen.getByRole('button', { name: '重试探测' }));
    expect(await screen.findByText('login-ready')).toBeInTheDocument();
  });

  it('rejects malformed session responses instead of treating them as configured', async () => {
    installFetch((url) => url.includes('/mode') ? json(mode) : json({}));
    render(<Home />);
    expect(await screen.findByRole('alert')).toHaveTextContent('authenticated');
    expect(screen.queryByText('dashboard-ready')).not.toBeInTheDocument();
  });

  it('exposes loading status until all authenticated probes complete', async () => {
    let resolveStatus!: (_response: Response) => void;
    installFetch((url) => {
      if (url.includes('/mode')) return json(mode);
      if (url.includes('/session')) return json(authenticated);
      return new Promise<Response>((resolve) => { resolveStatus = resolve; });
    });
    render(<Home />);
    expect(screen.getByRole('status')).toHaveTextContent('正在探测部署模式与登录会话');
    expect(screen.queryByText('dashboard-ready')).not.toBeInTheDocument();
    await waitFor(() => expect(resolveStatus).toBeTypeOf('function'));
    resolveStatus(json(setupComplete));
    expect(await screen.findByText('dashboard-ready')).toBeInTheDocument();
  });

  it('uses ?setup=1 even when the backend reports configured', async () => {
    window.history.replaceState({}, '', '/?setup=1');
    installFetch((url) => {
      if (url.includes('/mode')) return json(mode);
      if (url.includes('/session')) return json({ authenticated: false });
      return json(configured);
    });
    render(<Home />);
    expect(await screen.findByText('backend-setup-ready')).toBeInTheDocument();
  });

  it('keeps the stateless login route without requiring server pre-setup', async () => {
    installFetch((url) => url.includes('/mode')
      ? json({ authMode: 'stateless' })
      : url.includes('/session') ? json({ authenticated: false }) : json({}));
    render(<Home />);
    expect(await screen.findByText('stateless-login-ready')).toBeInTheDocument();
  });
});
