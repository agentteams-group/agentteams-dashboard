'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AuthenticatedDashboardBoundary,
  BackendSetupScreen,
  LoginScreen,
  SetupWizardScreen,
  StatelessLoginScreen,
} from './authenticated-dashboard-boundary';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { apiUrl } from '@/lib/api-base';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { AlertCircle, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; username?: string }
  | { status: 'unauthenticated' }
  // F7 stateless: the stored credential may still be valid, but the
  // backend is unreachable — do NOT ask the user to log in again.
  | { status: 'unreachable' }
  | { status: 'error'; stage: ProbeStage; message: string };

type SetupState =
  | { status: 'loading' }
  | { status: 'required' }
  | { status: 'complete' }
  | { status: 'error'; message: string };

// F1 pre-login backend setup gate: independent of the post-login wizard.
type PreSetupState =
  | { status: 'loading' }
  | { status: 'required' }
  | { status: 'complete' }
  | { status: 'error'; message: string };

type ProbeStage = 'mode' | 'session' | 'setup-status' | 'pre-setup';

interface ProbeError {
  stage: ProbeStage;
  message: string;
}

const STAGE_LABELS: Record<ProbeStage, string> = {
  mode: '部署模式',
  session: '登录会话',
  'setup-status': '初始化状态',
  'pre-setup': '后端配置状态',
};

async function probeJson(url: string): Promise<unknown> {
  const response = await fetch(apiUrl(url), { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function probeFailure(stage: ProbeStage, error: unknown): ProbeError {
  const detail = error instanceof Error ? error.message : '未知错误';
  return { stage, message: `${STAGE_LABELS[stage]}探测失败：${detail}` };
}

function StartupLoading({ label }: { label: string }) {
  return (
    <ThemeProvider>
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-card">
          <Loader2 className="mx-auto size-7 animate-spin text-primary" aria-hidden="true" />
          <h1 className="mt-4 text-lg font-semibold">正在启动 AgentTeams</h1>
          <p className="mt-2 text-sm text-muted-foreground" role="status" aria-live="polite">
            {label}
          </p>
        </div>
      </main>
      <Toaster position="top-right" richColors />
    </ThemeProvider>
  );
}

function StartupError({ error, onRetry, onConfigure }: {
  error: ProbeError;
  onRetry: () => void;
  onConfigure?: () => void;
}) {
  return (
    <ThemeProvider>
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-card">
          <AlertCircle className="mx-auto size-8 text-status-failed" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold">暂时无法确认启动状态</h1>
          <p className="mt-2 text-sm text-muted-foreground" role="alert">{error.message}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            未知状态不会被视为配置完成。请检查服务后重试。
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={onRetry}>
              <RefreshCw className="mr-2 size-4" aria-hidden="true" />
              重试探测
            </Button>
            {onConfigure && (
              <Button variant="outline" onClick={onConfigure}>
                <Settings2 className="mr-2 size-4" aria-hidden="true" />
                配置后端
              </Button>
            )}
          </div>
        </div>
      </main>
      <Toaster position="top-right" richColors />
    </ThemeProvider>
  );
}

export default function Home() {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [setup, setSetup] = useState<SetupState>({ status: 'loading' });
  const [preSetup, setPreSetup] = useState<PreSetupState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // F1e: ?setup=1 is the logged-out escape hatch for moved/broken backends.
  const [forceSetup, setForceSetup] = useState(false);
  const [staticReason, setStaticReason] = useState<'unauthorized' | 'invalid' | null>(null);
  const [staticDetail, setStaticDetail] = useState<string | undefined>(undefined);
  const [dataPlaneRejected, setDataPlaneRejected] = useState(false);
  const [authMode, setAuthMode] = useState<'stateful' | 'stateless' | null>(null);
  const [defaultHomeservers, setDefaultHomeservers] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      let stage: ProbeStage = 'mode';
      try {
        const modeData = await probeJson('/api/agentteams/mode') as {
          authMode?: unknown;
          defaultHomeservers?: unknown;
        } | null;
        if (!modeData || (modeData.authMode !== 'stateful' && modeData.authMode !== 'stateless')) {
          throw new Error('响应缺少有效的 authMode');
        }
        if (cancelled) return;
        setAuthMode(modeData.authMode);
        if (Array.isArray(modeData.defaultHomeservers)) {
          setDefaultHomeservers(modeData.defaultHomeservers.filter((value): value is string => typeof value === 'string'));
        }

        stage = 'session';
        const sessionData = await probeJson('/api/auth/session') as {
          authenticated?: unknown;
          username?: unknown;
          level?: unknown;
          reason?: unknown;
          detail?: unknown;
        } | null;
        if (!sessionData || typeof sessionData.authenticated !== 'boolean') {
          throw new Error('响应缺少有效的 authenticated 状态');
        }
        if (cancelled) return;

        if (!sessionData.authenticated) {
          setAuth({ status: sessionData.reason === 'unreachable' ? 'unreachable' : 'unauthenticated' });
          const params = new URLSearchParams(window.location.search);
          const bounced = params.get('reason') === 'unauthorized';
          const requestedSetup = params.get('setup') === '1';
          setForceSetup(requestedSetup);
          setStaticReason(sessionData.reason === 'invalid' ? 'invalid' : bounced ? 'unauthorized' : null);
          setStaticDetail(typeof sessionData.detail === 'string' ? sessionData.detail : undefined);
          setDataPlaneRejected(bounced && params.get('from') === 'data401');

          // Stateless addresses live in the browser; there is no server pre-setup gate.
          if (modeData.authMode === 'stateless') {
            setPreSetup({ status: 'complete' });
            return;
          }

          try {
            const preSetupData = await probeJson('/api/agentteams/setup/backends') as {
              configured?: unknown;
            } | null;
            if (typeof preSetupData?.configured !== 'boolean') {
              throw new Error('响应缺少有效的 configured 状态');
            }
            if (!cancelled) {
              setPreSetup({ status: requestedSetup || !preSetupData.configured ? 'required' : 'complete' });
            }
          } catch (error) {
            if (!cancelled) setPreSetup({ status: 'error', message: probeFailure('pre-setup', error).message });
          }
          return;
        }

        setAuth({ status: 'authenticated', username: typeof sessionData.username === 'string' ? sessionData.username : undefined });
        useAgentTeamsStore.getState().setUserLevel(typeof sessionData.level === 'number' ? sessionData.level : modeData.authMode === 'stateful' ? 3 : 1);
        if (typeof sessionData.username === 'string') {
          useAgentTeamsStore.getState().setSessionUser(sessionData.username);
        }

        try {
          const setupData = await probeJson('/api/agentteams/setup/status/') as {
            setupRequired?: unknown;
          } | null;
          if (typeof setupData?.setupRequired !== 'boolean') {
            throw new Error('响应缺少有效的 setupRequired 状态');
          }
          if (!cancelled) setSetup({ status: setupData.setupRequired ? 'required' : 'complete' });
        } catch (error) {
          if (!cancelled) setSetup({ status: 'error', message: probeFailure('setup-status', error).message });
        }
      } catch (error) {
        if (!cancelled) {
          const failure = probeFailure(stage, error);
          setAuth({ status: 'error', stage: failure.stage, message: failure.message });
        }
      }
    };

    // A retry is a new probe, not a continuation of a partially known state.
    setAuth({ status: 'loading' });
    setSetup({ status: 'loading' });
    setPreSetup({ status: 'loading' });
    setAuthMode(null);
    void run();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = () => setAttempt((value) => value + 1);
  const handleLoginSuccess = () => window.location.reload();

  if (auth.status === 'loading') return <StartupLoading label="正在探测部署模式与登录会话…" />;
  if (auth.status === 'error') return <StartupError error={{ stage: auth.stage, message: auth.message }} onRetry={retry} />;
  if (auth.status === 'unreachable') {
    return (
      <ThemeProvider>
        <main className="flex min-h-screen items-center justify-center bg-background p-4">
          <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-card">
            <AlertCircle className="mx-auto size-8 text-status-waiting" aria-hidden="true" />
            <h1 className="mt-3 text-lg font-semibold">后端不可达</h1>
            <p className="mt-2 text-sm text-muted-foreground" role="alert">
              无法连接 Controller 以校验当前凭据。若你的登录凭据仍然有效，恢复后端连接后重试即可，无需重新登录。
            </p>
            <Button className="mt-5" onClick={retry}>
              <RefreshCw className="mr-2 size-4" aria-hidden="true" />
              重试
            </Button>
          </div>
        </main>
        <Toaster position="top-right" richColors />
      </ThemeProvider>
    );
  }

  if (auth.status === 'authenticated' && setup.status === 'loading') {
    return <StartupLoading label="已确认登录，正在检查初始化状态…" />;
  }
  if (auth.status === 'authenticated' && setup.status === 'error') {
    return <StartupError error={{ stage: 'setup-status', message: setup.message }} onRetry={retry} />;
  }

  if (auth.status === 'unauthenticated') {
    if (authMode === 'stateless') {
      return (
        <ThemeProvider>
          <StatelessLoginScreen
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
    if (preSetup.status === 'loading') return <StartupLoading label="正在检查后端配置状态…" />;
    if (preSetup.status === 'error') {
      return (
        <StartupError
          error={{ stage: 'pre-setup', message: preSetup.message }}
          onRetry={retry}
          onConfigure={() => router.push('/?setup=1')}
        />
      );
    }
    return (
      <ThemeProvider>
        {preSetup.status === 'required' ? (
          <BackendSetupScreen onDone={handleLoginSuccess} reconfigure={forceSetup} />
        ) : (
          <LoginScreen onLoginSuccess={handleLoginSuccess} dataPlaneRejected={dataPlaneRejected} />
        )}
        <Toaster position="top-right" richColors />
      </ThemeProvider>
    );
  }

  if (setup.status === 'required') {
    return (
      <ThemeProvider>
        <SetupWizardScreen onComplete={() => window.location.reload()} />
        <Toaster position="top-right" richColors />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <AuthenticatedDashboardBoundary />
      <Toaster position="top-right" richColors />
    </ThemeProvider>
  );
}
