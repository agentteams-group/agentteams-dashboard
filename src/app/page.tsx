'use client';

import { useEffect, useState } from 'react';
import { AgentTeamsDashboard } from '@/components/dashboard/agent-teams-dashboard';
import { LoginPage } from '@/components/auth/login-page';
import { StatelessLoginPage } from '@/components/auth/stateless-login-page';
import { BackendSetupPage } from '@/components/setup/backend-setup-page';
import { SetupWizard } from '@/components/setup/setup-wizard';
import { QueryProvider } from '@/lib/query-provider';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { SearchProvider } from '@/lib/search-context';
import { apiUrl } from '@/lib/api-base';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; username?: string }
  | { status: 'unauthenticated' }
  // F7 stateless: the stored credential may still be valid, but the
  // backend is unreachable — do NOT show the login page (re-login would
  // fail against the same dead backend); show a retryable error card.
  | { status: 'unreachable' };

type SetupState =
  | { status: 'loading' }
  | { status: 'required' }
  | { status: 'complete' };

// F1 pre-login backend setup gate: independent of the (post-login)
// controller-side setup wizard above.
type PreSetupState = { status: 'loading' } | { status: 'required' } | { status: 'complete' };

export default function Home() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [setup, setSetup] = useState<SetupState>({ status: 'loading' });
  const [preSetup, setPreSetup] = useState<PreSetupState>({ status: 'loading' });
  // F1e: the login screen can deep-link here (?setup=1) to re-configure
  // backends when an existing deployment is broken or moved.
  const [forceSetup, setForceSetup] = useState(false);
  // F7: why the stateless login page should warn (expired vs invalid).
  const [staticReason, setStaticReason] = useState<'unauthorized' | 'invalid' | null>(null);
  const [staticDetail, setStaticDetail] = useState<string | undefined>(undefined);
  // Data-plane 401 bounce (client-auth-fetch): the login succeeded but the
  // Controller/gateway rejected the credential — the login page must show an
  // actionable error instead of letting the page retry the data plane.
  const [dataPlaneRejected, setDataPlaneRejected] = useState(false);
  // F7: which auth flow this deployment runs (from the public /mode probe).
  const [authMode, setAuthMode] = useState<'stateful' | 'stateless' | null>(null);
  // F7: server-side Matrix homeserver candidates (stateless deployments
  // only, from /mode) — prefill for the first-time login address.
  const [defaultHomeservers, setDefaultHomeservers] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Session check on mount; when authenticated, chain the setup-status check.
    // All setState calls happen in promise callbacks (external system → React).
    fetch(apiUrl('/api/agentteams/mode'), { credentials: 'same-origin' })
      .then((res) => res.json().catch(() => null))
      .then((modeData) => {
        // ── F7 stateless mode: the browser bearer token IS the credential ──
        // The client-auth fetch patch (layout) injects the stored token into
        // the session probe below. The pre-login backend-setup gate is
        // skipped: in the stateless shape the addresses live in the browser
        // (at_cfg), not in the server config file.
        if (modeData?.authMode === 'stateless') {
          if (!cancelled) setAuthMode('stateless');
          if (!cancelled && Array.isArray(modeData?.defaultHomeservers)) {
            setDefaultHomeservers(modeData.defaultHomeservers);
          }
          return fetch(apiUrl('/api/auth/session'), { credentials: 'same-origin' })
            .then((res) => res.json())
            .then((data) => {
              if (cancelled) return;
              if (data.authenticated) {
                useAgentTeamsStore.getState().setUserLevel(data.level ?? 1);
                if (data.username) {
                  useAgentTeamsStore.getState().setSessionUser(data.username);
                }
                setAuth({ status: 'authenticated', username: data.username });
                fetch(apiUrl('/api/agentteams/setup/status/'), { credentials: 'same-origin' })
                  .then((sres) => sres.json().catch(() => ({})))
                  .then((sdata) => {
                    if (!cancelled) setSetup({ status: sdata.setupRequired ? 'required' : 'complete' });
                  })
                  .catch(() => {
                    if (!cancelled) setSetup({ status: 'complete' });
                  });
                return;
              }
              if (data.reason === 'unreachable') {
                setAuth({ status: 'unreachable' });
                return;
              }
              setAuth({ status: 'unauthenticated' });
              const bounced = new URLSearchParams(window.location.search).get('reason') === 'unauthorized';
              setStaticReason(data.reason === 'invalid' ? 'invalid' : bounced ? 'unauthorized' : null);
              setStaticDetail(data.detail);
              setDataPlaneRejected(
                bounced && new URLSearchParams(window.location.search).get('from') === 'data401',
              );
            })
            .catch(() => {
              if (!cancelled) setAuth({ status: 'unreachable' });
            });
        }

        // ── Stateful mode: unchanged M19 session flow ──
        if (!cancelled) setAuthMode('stateful');
        return fetch(apiUrl('/api/auth/session'), { credentials: 'same-origin' })
          .then((res) => res.json())
          .then((data) => {
            if (cancelled) return;
            if (!data.authenticated) {
              setAuth({ status: 'unauthenticated' });
              const params = new URLSearchParams(window.location.search);
              // F1e: ?setup=1 forces the pre-login backend setup page from the
              // login screen (escape hatch — broken/changed environments).
              const forceSetup = params.get('setup') === '1';
              setForceSetup(forceSetup);
              // A data-plane bounce means the login was fine but the
              // Controller credential was rejected — surface it, never retry.
              setDataPlaneRejected(
                params.get('reason') === 'unauthorized' && params.get('from') === 'data401',
              );
              // F1: before offering the login form, check whether the dashboard
              // has any usable backend addresses. Standalone installs without
              // env config must configure backends FIRST (token-gated),
              // so unconfigured -> setup page instead of login.
              fetch(apiUrl('/api/agentteams/setup/backends'), { credentials: 'same-origin' })
                .then((res) => res.json().catch(() => null))
                .then((sdata) => {
                  if (cancelled) return;
                  const required = forceSetup || (sdata && sdata.configured === false);
                  setPreSetup({ status: required ? 'required' : 'complete' });
                })
                .catch(() => {
                  if (!cancelled) setPreSetup({ status: forceSetup ? 'required' : 'complete' });
                });
              return;
            }
            setAuth({ status: 'authenticated', username: data.username });
            // M19: publish the dashboard level for the UI level gate (nav items).
            // Falls back to 3 (full nav) when the session endpoint predates the
            // level field or in AUTH_DISABLED dev setups.
            useAgentTeamsStore.getState().setUserLevel(data.level ?? 3);
            // Account chip in the header (identity = the session's own username).
            if (data.username) {
              useAgentTeamsStore.getState().setSessionUser(data.username);
            }
            fetch(apiUrl('/api/agentteams/setup/status/'), { credentials: 'same-origin' })
              .then((res) => res.json().catch(() => ({})))
              .then((sdata) => {
                if (!cancelled) setSetup({ status: sdata.setupRequired ? 'required' : 'complete' });
              })
              .catch(() => {
                if (!cancelled) setSetup({ status: 'complete' });
              });
          })
          .catch(() => {
            if (!cancelled) setAuth({ status: 'unauthenticated' });
          });
      })
      .catch(() => {
        if (cancelled) return;
        // The mode probe itself failed (a dashboard-server hiccup — the
        // session fetch would fail too): assume stateful and degrade exactly
        // like the pre-F7 behavior (login page), never the stateless-only
        // unreachable card.
        setAuthMode('stateful');
        setPreSetup({ status: 'complete' });
        setAuth({ status: 'unauthenticated' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLoginSuccess = () => {
    window.location.reload();
  };

  // F7: backend unreachable with a possibly-valid stored credential — a
  // retryable card, never the login page (re-login would hit the same
  // dead backend and burn the user's password attempt).
  if (auth.status === 'unreachable') {
    return (
      <ThemeProvider>
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="w-full max-w-md rounded-lg border p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 mx-auto text-amber-500" />
            <h2 className="text-lg font-semibold">后端不可达</h2>
            <p className="text-sm text-muted-foreground">
              无法连接 Controller 以校验当前凭据。若你的登录凭据仍然有效，恢复后端连接后重试即可，无需重新登录。
            </p>
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              重试
            </Button>
          </div>
        </div>
        <Toaster position="top-right" richColors />
      </ThemeProvider>
    );
  }

  if (auth.status === 'loading' || (auth.status === 'authenticated' && setup.status === 'loading')) {
    return null;
  }

  if (auth.status === 'unauthenticated') {
    // F7 stateless: the session probe already told us (reason set) — the
    // addresses are browser-side, so the server preSetup gate is skipped
    // and the stateless login form renders directly.
    if (authMode === 'stateless') {
      return (
        <ThemeProvider>
          <StatelessLoginPage
            onLoginSuccess={handleLoginSuccess}
            reason={staticReason}
            detail={staticDetail}
            defaultHomeservers={defaultHomeservers ?? undefined}
            fromData401={dataPlaneRejected}
          />
          <Toaster position="top-right" richColors />
        </ThemeProvider>
      );
    }
    if (preSetup.status === 'loading') return null;
    return (
      <ThemeProvider>
        {preSetup.status === 'required' ? (
          <BackendSetupPage onDone={handleLoginSuccess} reconfigure={forceSetup} />
        ) : (
          <LoginPage onLoginSuccess={handleLoginSuccess} dataPlaneRejected={dataPlaneRejected} />
        )}
        <Toaster position="top-right" richColors />
      </ThemeProvider>
    );
  }

  if (setup.status === 'required') {
    return (
      <ThemeProvider>
        <SetupWizard onComplete={() => window.location.reload()} />
        <Toaster position="top-right" richColors />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <QueryProvider>
        <SearchProvider>
          <AgentTeamsDashboard />
        </SearchProvider>
      </QueryProvider>
      <Toaster position="top-right" richColors />
    </ThemeProvider>
  );
}
