'use client';

import { lazy, Suspense, type ComponentProps, type ElementType } from 'react';
import { Loader2 } from 'lucide-react';
import { SearchProvider } from '@/lib/search-context';

/**
 * Independent code-splitting boundary for the page startup state machine.
 * The page owns authentication/setup decisions; only the selected screen's code
 * is requested.
 */
export const LazyQueryProvider = lazy(() => import('@/lib/query-provider').then((m) => ({ default: m.QueryProvider })));
export const LazyAgentTeamsDashboard = lazy(() => import('@/components/dashboard/agent-teams-dashboard').then((m) => ({ default: m.AgentTeamsDashboard })));
export const LazyLoginPage = lazy(() => import('@/components/auth/login-page').then((m) => ({ default: m.LoginPage })));
export const LazyStatelessLoginPage = lazy(() => import('@/components/auth/stateless-login-page').then((m) => ({ default: m.StatelessLoginPage })));
export const LazyBackendSetupPage = lazy(() => import('@/components/setup/backend-setup-page').then((m) => ({ default: m.BackendSetupPage })));
export const LazySetupWizard = lazy(() => import('@/components/setup/setup-wizard').then((m) => ({ default: m.SetupWizard })));

export function ScreenLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background" role="status" aria-label="正在加载页面">
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
    </main>
  );
}

/** Authenticated subtree; no startup probes or state live here. */
export function AuthenticatedDashboardBoundary() {
  return (
    <Suspense fallback={<ScreenLoading />}>
      <LazyQueryProvider>
        <SearchProvider>
          <LazyAgentTeamsDashboard />
        </SearchProvider>
      </LazyQueryProvider>
    </Suspense>
  );
}

type LazyScreenProps<T extends ElementType> = ComponentProps<T>;

/** Typed wrappers keep page call sites unchanged apart from the import source. */
export function LoginScreen(props: LazyScreenProps<typeof LazyLoginPage>) {
  return <Suspense fallback={<ScreenLoading />}><LazyLoginPage {...props} /></Suspense>;
}
export function StatelessLoginScreen(props: LazyScreenProps<typeof LazyStatelessLoginPage>) {
  return <Suspense fallback={<ScreenLoading />}><LazyStatelessLoginPage {...props} /></Suspense>;
}
export function BackendSetupScreen(props: LazyScreenProps<typeof LazyBackendSetupPage>) {
  return <Suspense fallback={<ScreenLoading />}><LazyBackendSetupPage {...props} /></Suspense>;
}
export function SetupWizardScreen(props: LazyScreenProps<typeof LazySetupWizard>) {
  return <Suspense fallback={<ScreenLoading />}><LazySetupWizard {...props} /></Suspense>;
}
