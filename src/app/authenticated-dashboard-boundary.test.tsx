import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/query-provider', () => ({
  QueryProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="query-provider">{children}</div>,
}));
vi.mock('@/lib/search-context', () => ({
  SearchProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="search-provider">{children}</div>,
}));
vi.mock('@/components/dashboard/agent-teams-dashboard', () => ({
  AgentTeamsDashboard: () => <div>dashboard-screen</div>,
}));
vi.mock('@/components/auth/login-page', () => ({ LoginPage: () => <div>login-screen</div> }));
vi.mock('@/components/auth/stateless-login-page', () => ({ StatelessLoginPage: () => <div>stateless-login-screen</div> }));
vi.mock('@/components/setup/backend-setup-page', () => ({ BackendSetupPage: () => <div>backend-setup-screen</div> }));
vi.mock('@/components/setup/setup-wizard', () => ({ SetupWizard: () => <div>setup-wizard-screen</div> }));

import {
  AuthenticatedDashboardBoundary,
  BackendSetupScreen,
  LoginScreen,
  SetupWizardScreen,
  StatelessLoginScreen,
} from './authenticated-dashboard-boundary';

afterEach(cleanup);

describe('authenticated dashboard lazy boundary', () => {
  it('loads only the selected startup screen', async () => {
    render(<LoginScreen />);
    expect(await screen.findByText('login-screen')).toBeInTheDocument();
    expect(screen.queryByText('dashboard-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('query-provider')).not.toBeInTheDocument();
  });

  it('wraps the authenticated dashboard with lazy query and search providers', async () => {
    render(<AuthenticatedDashboardBoundary />);
    expect(await screen.findByText('dashboard-screen')).toBeInTheDocument();
    expect(screen.getByTestId('query-provider')).toContainElement(screen.getByTestId('search-provider'));
  });

  it('keeps every setup and login state behind the same lazy boundary', async () => {
    const { rerender } = render(<StatelessLoginScreen />);
    expect(await screen.findByText('stateless-login-screen')).toBeInTheDocument();
    rerender(<BackendSetupScreen onDone={() => {}} />);
    expect(await screen.findByText('backend-setup-screen')).toBeInTheDocument();
    rerender(<SetupWizardScreen />);
    expect(await screen.findByText('setup-wizard-screen')).toBeInTheDocument();
  });
});
