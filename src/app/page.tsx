'use client';

import { useEffect, useState } from 'react';
import { AgentTeamsDashboard } from '@/components/dashboard/agent-teams-dashboard';
import { LoginPage } from '@/components/auth/login-page';
import { SetupWizard } from '@/components/setup/setup-wizard';
import { QueryProvider } from '@/lib/query-provider';
import { SearchProvider } from '@/lib/search-context';
import { apiUrl } from '@/lib/api-base';
import { ThemeProvider } from 'next-themes';

type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; username?: string }
  | { status: 'unauthenticated' };

type SetupState =
  | { status: 'loading' }
  | { status: 'required' }
  | { status: 'complete' };

export default function Home() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [setup, setSetup] = useState<SetupState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    // Session check on mount; when authenticated, chain the setup-status check.
    // All setState calls happen in promise callbacks (external system → React).
    fetch(apiUrl('/api/auth/session'), { credentials: 'same-origin' })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.authenticated) {
          setAuth({ status: 'unauthenticated' });
          return;
        }
        setAuth({ status: 'authenticated', username: data.username });
        fetch(apiUrl('/api/agentteams/setup/status/'), { credentials: 'same-origin' })
          .then((res) => res.json().catch(() => ({})))
          .then((sdata) => {
            if (cancelled) return;
            setSetup({ status: sdata.setupRequired ? 'required' : 'complete' });
          })
          .catch(() => {
            if (!cancelled) setSetup({ status: 'complete' });
          });
      })
      .catch(() => {
        if (!cancelled) setAuth({ status: 'unauthenticated' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLoginSuccess = () => {
    window.location.reload();
  };

  if (auth.status === 'loading' || (auth.status === 'authenticated' && setup.status === 'loading')) {
    return null;
  }

  if (auth.status === 'unauthenticated') {
    return (
      <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
        <LoginPage onLoginSuccess={handleLoginSuccess} />
      </ThemeProvider>
    );
  }

  if (setup.status === 'required') {
    return (
      <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
        <SetupWizard onComplete={() => window.location.reload()} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
      <QueryProvider>
        <SearchProvider>
          <AgentTeamsDashboard />
        </SearchProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
