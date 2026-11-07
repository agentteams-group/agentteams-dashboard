'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { EnterpriseThemeConfig, ThemeDefinition } from './types';
import { SYSTEM_THEME_ID, THEME_STORAGE_KEY } from './types';
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from './themes';
import { normalizeThemeSchedule, scheduledThemeId, SCHEDULED_THEME_ID, type ThemeSchedule } from './schedule';

export { THEME_STORAGE_KEY };

interface ThemeState {
  /** Selected theme id; 'system' follows the OS preference. */
  themeId: string;
  themeSchedule: ThemeSchedule;
  /** User-created themes. */
  customThemes: ThemeDefinition[];
  /** Enterprise themes injected via theme.config.json (not persisted). */
  enterpriseThemes: ThemeDefinition[];
  enterpriseDefaultTheme: string | null;
  enterpriseLocked: boolean;
  /** True once the enterprise config request has settled. */
  enterpriseLoaded: boolean;

  setThemeId: (_id: string) => void;
  setThemeSchedule: (_schedule: ThemeSchedule) => void;
  addCustomTheme: (_theme: ThemeDefinition) => void;
  updateCustomTheme: (_theme: ThemeDefinition) => void;
  removeCustomTheme: (_id: string) => void;
  setEnterpriseConfig: (_config: EnterpriseThemeConfig | null) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      themeId: SCHEDULED_THEME_ID,
      themeSchedule: normalizeThemeSchedule(undefined),
      customThemes: [],
      enterpriseThemes: [],
      enterpriseDefaultTheme: null,
      enterpriseLocked: false,
      enterpriseLoaded: false,

      setThemeId: (id: string) => {
        if (get().enterpriseLocked) return;
        set({ themeId: id });
      },

      setThemeSchedule: (schedule) => {
        if (get().enterpriseLocked) return;
        set({ themeSchedule: normalizeThemeSchedule(schedule) });
      },

      addCustomTheme: (theme: ThemeDefinition) => {
        set((state) => ({
          customThemes: [...state.customThemes.filter((t) => t.id !== theme.id), theme],
        }));
      },

      updateCustomTheme: (theme: ThemeDefinition) => {
        set((state) => ({
          customThemes: state.customThemes.map((t) => (t.id === theme.id ? theme : t)),
        }));
      },

      removeCustomTheme: (id: string) => {
        set((state) => {
          const customThemes = state.customThemes.filter((t) => t.id !== id);
          const themeId = state.themeId === id ? DEFAULT_THEME_ID : state.themeId;
          return { customThemes, themeId };
        });
      },

      setEnterpriseConfig: (config: EnterpriseThemeConfig | null) => {
        if (!config) {
          set({ enterpriseThemes: [], enterpriseDefaultTheme: null, enterpriseLocked: false, enterpriseLoaded: true });
          return;
        }
        set((state) => {
          const themes = config.themes.map((t) => ({ ...t, enterprise: true }));
          // If the user never picked a theme explicitly, honor the enterprise default.
          const themeId =
            (state.themeId === SYSTEM_THEME_ID || state.themeId === SCHEDULED_THEME_ID) && config.defaultTheme
              ? config.defaultTheme
              : state.themeId;
          return {
            enterpriseThemes: themes,
            enterpriseDefaultTheme: config.defaultTheme ?? null,
            enterpriseLocked: config.locked === true,
            enterpriseLoaded: true,
            themeId,
          };
        });
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        themeId: state.themeId,
        themeSchedule: state.themeSchedule,
        customThemes: state.customThemes,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<ThemeState> | undefined;
        return { ...current, ...saved, themeSchedule: normalizeThemeSchedule(saved?.themeSchedule) };
      },
    }
  )
);

/** All themes the user can pick from, in display order. */
export function selectAvailableThemes(state: Pick<ThemeState, 'customThemes' | 'enterpriseThemes'>): ThemeDefinition[] {
  return [...BUILTIN_THEMES, ...state.customThemes, ...state.enterpriseThemes];
}

/**
 * Resolves the theme definition that should be applied right now.
 * `prefersDark` is the current OS preference, used when themeId = 'system'.
 */
export function resolveTheme(
  state: Pick<ThemeState, 'themeId' | 'customThemes' | 'enterpriseThemes' | 'enterpriseLocked' | 'enterpriseDefaultTheme'> & Partial<Pick<ThemeState, 'themeSchedule'>>,
  prefersDark: boolean,
  minuteOfDay?: number
): ThemeDefinition {
  const all = selectAvailableThemes(state);
  const effectiveId =
    state.enterpriseLocked && state.enterpriseDefaultTheme
      ? state.enterpriseDefaultTheme
      : state.themeId;

  if (effectiveId === SYSTEM_THEME_ID) {
    return BUILTIN_THEMES.find((t) => t.id === (prefersDark ? 'dark' : 'light'))!;
  }
  if (effectiveId === SCHEDULED_THEME_ID) {
    const now = new Date();
    const minute = minuteOfDay ?? now.getHours() * 60 + now.getMinutes();
    return BUILTIN_THEMES.find((t) => t.id === scheduledThemeId(normalizeThemeSchedule(state.themeSchedule), minute))!;
  }
  return all.find((t) => t.id === effectiveId) ?? BUILTIN_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}
