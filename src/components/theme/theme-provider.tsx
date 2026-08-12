'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { applyTheme } from '@/lib/theme/apply';
import { selectAvailableThemes, resolveTheme, useThemeStore } from '@/lib/theme/theme-store';
import { apiUrl } from '@/lib/api-base';
import type { EnterpriseThemeConfig, ThemeDefinition } from '@/lib/theme/types';
import { SYSTEM_THEME_ID } from '@/lib/theme/types';
import { normalizeThemeDefinition, ThemeConfigError } from '@/lib/theme/config';

export interface UseThemeResult {
  /** The id the user picked ('system' when following the OS). */
  theme: string;
  /** The theme definition actually applied right now. */
  resolvedTheme: ThemeDefinition;
  /** All pickable themes (built-in + custom + enterprise). */
  themes: ThemeDefinition[];
  /** Switch theme by id; pass 'system' to follow the OS preference. */
  setTheme: (_id: string) => void;
  /** True when an enterprise config prevents switching. */
  locked: boolean;
  /** True while the enterprise config request is in flight. */
  loadingEnterprise: boolean;
}

const ThemeContext = createContext<UseThemeResult | null>(null);

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

function subscribeToColorScheme(callback: () => void): () => void {
  if (!hasMatchMedia()) {
    return () => {};
  }
  const mql = window.matchMedia(DARK_MEDIA_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSystemPrefersDark(): boolean {
  return hasMatchMedia() ? window.matchMedia(DARK_MEDIA_QUERY).matches : true;
}

/** Reactive OS color-scheme preference (no setState-in-effect needed). */
function useSystemPrefersDark(): boolean {
  return useSyncExternalStore(subscribeToColorScheme, getSystemPrefersDark, () => true);
}

async function fetchEnterpriseConfig(): Promise<EnterpriseThemeConfig | null> {
  try {
    const res = await fetch(apiUrl('/api/dashboard/theme'), { credentials: 'same-origin' });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const raw = (await res.json()) as { themes?: unknown[]; defaultTheme?: unknown; locked?: unknown };
    const themes = Array.isArray(raw.themes)
      ? raw.themes
          .map((t) => {
            try {
              return normalizeThemeDefinition(t, { allowEnterprise: true });
            } catch (err) {
              if (err instanceof ThemeConfigError) {
                console.warn('[theme] skip invalid enterprise theme:', err.message);
              }
              return null;
            }
          })
          .filter((t): t is ThemeDefinition => t !== null)
      : [];
    return {
      themes,
      defaultTheme: typeof raw.defaultTheme === 'string' ? raw.defaultTheme : undefined,
      locked: raw.locked === true,
    };
  } catch {
    return null;
  }
}

export interface ThemeProviderProps {
  children: ReactNode;
  /** Skip fetching the enterprise theme.config.json (tests / login page). */
  disableEnterprise?: boolean;
}

export function ThemeProvider({ children, disableEnterprise = false }: ThemeProviderProps) {
  const prefersDark = useSystemPrefersDark();
  const themeId = useThemeStore((s) => s.themeId);
  const customThemes = useThemeStore((s) => s.customThemes);
  const enterpriseThemes = useThemeStore((s) => s.enterpriseThemes);
  const enterpriseLocked = useThemeStore((s) => s.enterpriseLocked);
  const enterpriseDefaultTheme = useThemeStore((s) => s.enterpriseDefaultTheme);
  const enterpriseLoaded = useThemeStore((s) => s.enterpriseLoaded);
  const setThemeId = useThemeStore((s) => s.setThemeId);
  const setEnterpriseConfig = useThemeStore((s) => s.setEnterpriseConfig);

  const [loadingEnterprise, setLoadingEnterprise] = useState(!disableEnterprise);

  // Load enterprise configuration once.
  useEffect(() => {
    if (disableEnterprise) {
      setEnterpriseConfig(null);
      return;
    }
    let cancelled = false;
    fetchEnterpriseConfig()
      .then((config) => {
        if (cancelled) return;
        setEnterpriseConfig(config);
      })
      .finally(() => {
        if (!cancelled) setLoadingEnterprise(false);
      });
    return () => {
      cancelled = true;
    };
    // setEnterpriseConfig is stable (zustand action identity never changes).
  }, [disableEnterprise, setEnterpriseConfig]);

  const resolvedTheme = useMemo(
    () =>
      resolveTheme(
        { themeId, customThemes, enterpriseThemes, enterpriseLocked, enterpriseDefaultTheme },
        prefersDark
      ),
    [themeId, customThemes, enterpriseThemes, enterpriseLocked, enterpriseDefaultTheme, prefersDark]
  );

  // Apply synchronously whenever the effective theme changes.
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((id: string) => setThemeId(id), [setThemeId]);

  const value = useMemo<UseThemeResult>(
    () => ({
      theme: themeId,
      resolvedTheme,
      themes: selectAvailableThemes({ customThemes, enterpriseThemes }),
      setTheme,
      locked: enterpriseLocked,
      loadingEnterprise: loadingEnterprise && !enterpriseLoaded,
    }),
    [themeId, resolvedTheme, customThemes, enterpriseThemes, setTheme, enterpriseLocked, loadingEnterprise, enterpriseLoaded]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): UseThemeResult {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}

export { SYSTEM_THEME_ID };
