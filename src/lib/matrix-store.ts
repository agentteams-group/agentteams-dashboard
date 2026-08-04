import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { matrixApi } from './matrix-api';
import { formatErrorMessage } from './api-error';

interface MatrixState {
  // Connection
  homeserver: string;
  accessToken: string;
  userId: string;
  deviceId: string;
  isLoggedIn: boolean;
  isLoggingIn: boolean;
  loginError: string | null;

  // Sync
  syncToken: string | null;
  isSyncing: boolean;
  /**
   * Monotonic generation counter used to invalidate in-flight /sync loops.
   * Bumped on logout so a long-poll response that arrives after logout cannot
   * restart a sync loop with stale credentials.
   */
  syncGeneration: number;

  // Actions
  login: (_homeserver: string, _username: string, _password: string) => Promise<boolean>;
  setMatrixAuth: (_data: { accessToken: string; userId: string; deviceId: string; homeserver: string }) => void;
  logout: () => void;
  setHomeserver: (_url: string) => void;
  setSyncToken: (_token: string | null) => void;
  setSyncing: (_syncing: boolean) => void;
  invalidateSyncGeneration: () => void;
}

const PERSISTED_KEY = 'matrix-store';

export const useMatrixStore = create<MatrixState>()(
  persist(
    (set) => ({
      homeserver: '',
      accessToken: '',
      userId: '',
      deviceId: '',
      isLoggedIn: false,
      isLoggingIn: false,
      loginError: null,
      syncToken: null,
      isSyncing: false,
      syncGeneration: 0,

      login: async (homeserver: string, username: string, password: string) => {
        set({ isLoggingIn: true, loginError: null });
        try {
          const result = await matrixApi.login(homeserver, username, password);
          set({
            homeserver,
            accessToken: result.access_token,
            userId: result.user_id,
            deviceId: result.device_id,
            isLoggedIn: true,
            isLoggingIn: false,
            loginError: null,
            syncToken: null,
          });
          return true;
        } catch (err) {
          const message = formatErrorMessage(err, 'Login failed');
          set({
            isLoggingIn: false,
            loginError: message,
            isLoggedIn: false,
          });
          return false;
        }
      },

      /** Set Matrix auth from server-side auto-login result (e.g. from /api/auth/login). */
      setMatrixAuth: (data: { accessToken: string; userId: string; deviceId: string; homeserver: string }) => {
        set({
          homeserver: data.homeserver,
          accessToken: data.accessToken,
          userId: data.userId,
          deviceId: data.deviceId,
          isLoggedIn: true,
          loginError: null,
          syncToken: null,
        });
      },

      logout: () => {
        set((state) => ({
          accessToken: '',
          userId: '',
          deviceId: '',
          isLoggedIn: false,
          loginError: null,
          syncToken: null,
          isSyncing: false,
          // Invalidate any in-flight sync loops (see syncGeneration).
          syncGeneration: state.syncGeneration + 1,
        }));
      },

      setHomeserver: (url: string) => set({ homeserver: url }),
      setSyncToken: (token: string | null) => set({ syncToken: token }),
      setSyncing: (syncing: boolean) => set({ isSyncing: syncing }),
      invalidateSyncGeneration: () => set((state) => ({ syncGeneration: state.syncGeneration + 1 })),
    }),
    {
      name: PERSISTED_KEY,
      partialize: (state) => ({
        homeserver: state.homeserver,
        accessToken: state.accessToken,
        userId: state.userId,
        deviceId: state.deviceId,
        isLoggedIn: state.isLoggedIn,
        syncToken: state.syncToken,
      }),
    }
  )
);


