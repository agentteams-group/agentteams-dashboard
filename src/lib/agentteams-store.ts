import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiUrl } from '@/lib/api-base';

export interface ConnectionAttempt {
  timestamp: number;
  url: string;
  success: boolean;
  latency: number | null;
  error: string | null;
}

interface AgentTeamsState {
  controllerUrl: string;
  isConnected: boolean;
  connectionError: string | null;
  isChecking: boolean;
  settingsOpen: boolean;
  autoReconnect: boolean;
  reconnectInterval: number;
  lastConnectedAt: number | null;
  connectionLatency: number | null;
  connectionHistory: ConnectionAttempt[];

  /**
   * Whether the 任务看板 nav item is visible (beta feature). Defaults to
   * true so the board is on out of the box; users can opt out in Settings.
   * Hidden = the nav item is removed, the section route still works if
   * navigated to directly.
   */
  taskBoardVisible: boolean;

  /**
   * 经典导航开关（PRD §5.4）：开启后侧栏回退到 v1.x 的 13 项三组平铺，
   * 供老用户过渡。默认关（Workbench 两级导航）。保留一个版本周期。
   */
  classicNavigation: boolean;

  /**
   * Dashboard rbac level of the logged-in user (M19 dual track):
   * 3 Admin (L1, SA credential) / 2 Operator (L2, own Matrix token) /
   * 1 Observer. Used ONLY for the UI level gate — the security boundary is
   * server-side (middleware + Controller A2). Default 3 so unauthenticated
   * dev setups (AUTH_DISABLED) keep full nav; the session endpoint sets the
   * real level on mount. Deliberately NOT persisted.
   */
  userLevel: number;

  /**
   * Current dashboard session username (from /api/auth/session on mount).
   * Null when unauthenticated. Drives the header account chip.
   * Deliberately NOT persisted (partialize) — identity must never survive
   * a page reload without a fresh session check.
   */
   sessionUser: string | null;

   setControllerUrl: (_url: string) => void;
  checkConnection: () => Promise<boolean>;
  openSettings: () => void;
  closeSettings: () => void;
  setAutoReconnect: (_val: boolean) => void;
  setReconnectInterval: (_ms: number) => void;
  setTaskBoardVisible: (_val: boolean) => void;
  setClassicNavigation: (_val: boolean) => void;
  setUserLevel: (_val: number) => void;
  setSessionUser: (_val: string | null) => void;
  addConnectionAttempt: (_attempt: ConnectionAttempt) => void;
}

const MAX_HISTORY = 5;

export const useAgentTeamsStore = create<AgentTeamsState>()(
  persist(
    (set, get) => ({
      // Empty string means "use the server-side AGENTTEAMS_CONTROLLER_URL default".
      // This keeps the same dashboard image working in embedded (localhost)
      // and Kubernetes (in-cluster service) deployments.
      controllerUrl: process.env.NEXT_PUBLIC_AGENTTEAMS_CONTROLLER_URL || '',
      isConnected: false,
      connectionError: null,
      isChecking: false,
      settingsOpen: false,
      autoReconnect: true,
      reconnectInterval: 15000,
      lastConnectedAt: null,
      connectionLatency: null,
      connectionHistory: [],
      taskBoardVisible: true,
      classicNavigation: false,
      userLevel: 3,
      sessionUser: null,

      setControllerUrl: (url: string) => {
        set({ controllerUrl: url });
      },

      checkConnection: async () => {
        set({ isChecking: true, connectionError: null });
        const url = get().controllerUrl;
        const start = performance.now();
        try {
          const healthPath = url.trim()
            ? `/api/agentteams/healthz/?controllerUrl=${encodeURIComponent(url)}`
            : '/api/agentteams/healthz/';
          const res = await fetch(apiUrl(healthPath));
          const latency = Math.round(performance.now() - start);
          if (res.ok) {
            const text = await res.text();
            if (text.trim() === 'ok') {
              const attempt: ConnectionAttempt = {
                timestamp: Date.now(),
                url,
                success: true,
                latency,
                error: null,
              };
              const history = [attempt, ...get().connectionHistory].slice(0, MAX_HISTORY);
              set({
                isConnected: true,
                connectionError: null,
                isChecking: false,
                lastConnectedAt: Date.now(),
                connectionLatency: latency,
                connectionHistory: history,
              });
              return true;
            }
          }
          const attempt: ConnectionAttempt = {
            timestamp: Date.now(),
            url,
            success: false,
            latency,
            error: '连接失败',
          };
          const history = [attempt, ...get().connectionHistory].slice(0, MAX_HISTORY);
          set({ isConnected: false, connectionError: '连接失败', isChecking: false, connectionHistory: history });
          return false;
        } catch (err) {
          const latency = Math.round(performance.now() - start);
          const message = err instanceof Error ? err.message : '连接失败';
          const attempt: ConnectionAttempt = {
            timestamp: Date.now(),
            url,
            success: false,
            latency,
            error: message,
          };
          const history = [attempt, ...get().connectionHistory].slice(0, MAX_HISTORY);
          set({ isConnected: false, connectionError: message, isChecking: false, connectionHistory: history });
          return false;
        }
      },

      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),

      setAutoReconnect: (val: boolean) => {
        set({ autoReconnect: val });
      },

      setReconnectInterval: (ms: number) => {
        set({ reconnectInterval: ms });
      },

      setTaskBoardVisible: (val: boolean) => {
        set({ taskBoardVisible: val });
      },

      setClassicNavigation: (val: boolean) => {
        set({ classicNavigation: val });
      },

      setUserLevel: (val: number) => {
        set({ userLevel: val });
      },

      setSessionUser: (val: string | null) => {
        set({ sessionUser: val });
      },

      addConnectionAttempt: (attempt: ConnectionAttempt) => {
        const history = [attempt, ...get().connectionHistory].slice(0, MAX_HISTORY);
        set({ connectionHistory: history });
      },
    }),
    {
      name: 'agentteams-store',
      version: 4,
      partialize: (state) => ({
        controllerUrl: state.controllerUrl,
        autoReconnect: state.autoReconnect,
        reconnectInterval: state.reconnectInterval,
        lastConnectedAt: state.lastConnectedAt,
        taskBoardVisible: state.taskBoardVisible,
        classicNavigation: state.classicNavigation,
      }),
      migrate: (persistedState) => {
        // Clear the legacy hard-coded default so the dashboard falls back to
        // the server-side AGENTTEAMS_CONTROLLER_URL env var (works for embedded
        // localhost and Kubernetes in-cluster deployments).
        const s = persistedState as Partial<AgentTeamsState>;
        if (s.controllerUrl === 'http://agentteams-controller.agentteams-system:8090') {
          s.controllerUrl = '';
        }
        // v1 -> v2: both beta features (任务看板/项目) now default to enabled.
        // v1 states were persisted with the old default (false) regardless of
        // whether the user ever touched the switch, so force-enable once and
        // let users opt back out from Settings if they prefer.
        if (s.taskBoardVisible === undefined || s.taskBoardVisible === false) {
          s.taskBoardVisible = true;
        }
        // v2 -> v3: the standalone 项目 section was merged into the task
        // board's project view, so projectsVisible is dropped entirely.
        // Unknown persisted keys are ignored by the merge; nothing to do.
        return s as AgentTeamsState;
      },
    }
  )
);

// Global auto-reconnect effect - subscribes to store and manages interval outside React
let reconnectTimer: ReturnType<typeof setInterval> | null = null;

function startAutoReconnect() {
  stopAutoReconnect();
  const { reconnectInterval, isConnected, isChecking, settingsOpen } = useAgentTeamsStore.getState();
  
  // Don't start if already connected, currently checking, or settings open
  if (isConnected || isChecking || settingsOpen) return;

  reconnectTimer = setInterval(() => {
    const state = useAgentTeamsStore.getState();
    // Only attempt if auto-reconnect is on, not connected, not checking, and settings not open
    if (state.autoReconnect && !state.isConnected && !state.isChecking && !state.settingsOpen) {
      state.checkConnection();
    } else if (state.isConnected || !state.autoReconnect) {
      // Stop if connected or auto-reconnect disabled
      stopAutoReconnect();
    }
  }, reconnectInterval);
}

function stopAutoReconnect() {
  if (reconnectTimer !== null) {
    clearInterval(reconnectTimer);
    reconnectTimer = null;
  }
}

// Subscribe to store changes to manage auto-reconnect.
// Guard with window check so this does not run during SSR / Next.js build.
if (typeof window !== 'undefined') {
  useAgentTeamsStore.subscribe((state, prevState) => {
  const shouldReconnect = state.autoReconnect && !state.isConnected && !state.settingsOpen;
  const wasReconnecting = prevState.autoReconnect && !prevState.isConnected && !prevState.settingsOpen;

  if (shouldReconnect && !wasReconnecting) {
    // Disconnected or autoReconnect turned on or settings closed
    startAutoReconnect();
  } else if (!shouldReconnect && wasReconnecting) {
    // Connected or autoReconnect turned off or settings opened
    stopAutoReconnect();
  }

  // If reconnectInterval changed while reconnecting, restart with new interval
  if (state.reconnectInterval !== prevState.reconnectInterval && shouldReconnect) {
    startAutoReconnect();
  }
  });

  // FUNC-03: the subscription above only fires on a state TRANSITION into
  // the disconnected-and-enabled shape. A store that mounts already
  // disconnected (initial state or a rehydrated offline session) never
  // produces that transition, so the timer would never start until the user
  // toggled settings. Kick it once at module init — startAutoReconnect is
  // idempotent (stop-then-start) and a no-op when already connected.
  startAutoReconnect();
}
