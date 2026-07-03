'use client';

import { useEffect, useState } from 'react';
import { HiClawDashboard } from '@/components/dashboard/hi-claw-dashboard';
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

  const checkSession = async () => {
    try {
      const res = await fetch(apiUrl('/api/auth/session'), {
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (data.authenticated) {
        setAuth({ status: 'authenticated', username: data.username });
      } else {
        setAuth({ status: 'unauthenticated' });
      }
    } catch {
      setAuth({ status: 'unauthenticated' });
    }
  };

  const checkSetup = async () => {
    try {
      const res = await fetch(apiUrl('/api/hiclaw/setup/status/'), {
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (data.setupRequired) {
        setSetup({ status: 'required' });
      } else {
        setSetup({ status: 'complete' });
      }
    } catch {
      setSetup({ status: 'complete' });
    }
  };

  useEffect(() => {
    checkSession();
  }, []);

  useEffect(() => {
    if (auth.status === 'authenticated') {
      checkSetup();
    }
  }, [auth.status]);

  const handleLoginSuccess = () => {
    window.location.reload();
  };

  if (auth.status === 'loading' || (auth.status === 'authenticated' && setup.status === 'loading')) {
    return null;
  }

  if (auth.status === 'unauthenticated') {
    return (
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <LoginPage onLoginSuccess={handleLoginSuccess} />
      </ThemeProvider>
    );
  }

  if (setup.status === 'required') {
    return (
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <SetupWizard onComplete={() => window.location.reload()} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryProvider>
        <SearchProvider>
          <HiClawDashboard />
        </SearchProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
