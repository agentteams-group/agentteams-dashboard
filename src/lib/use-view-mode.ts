'use client';

import { useState, useCallback, useEffect, Dispatch, SetStateAction } from 'react';

export type ViewMode = 'card' | 'table' | 'compact';

export interface UseViewModeReturn {
  viewMode: ViewMode;
  setViewMode: Dispatch<SetStateAction<ViewMode>>;
  handleViewModeChange: (_value: string) => void;
}

const VALID_MODES: readonly ViewMode[] = ['card', 'table', 'compact'];

function readStoredMode(storageKey: string): ViewMode | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw && (VALID_MODES as readonly string[]).includes(raw) ? (raw as ViewMode) : null;
  } catch {
    return null;
  }
}

/**
 * Card/table(/compact) view switcher state. Pass `storageKey` to persist the
 * preference to localStorage; the stored value is applied after mount so SSR
 * output stays stable.
 */
export function useViewMode(initial: ViewMode = 'card', storageKey?: string): UseViewModeReturn {
  const [viewMode, setViewMode] = useState<ViewMode>(initial);

  useEffect(() => {
    if (!storageKey) return;
    const stored = readStoredMode(storageKey);
    // Reading localStorage must happen post-mount (SSR renders the default);
    // applying the stored preference is exactly the effect's job.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored && stored !== initial) setViewMode(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const handleViewModeChange = useCallback(
    (value: string) => {
      if (!(VALID_MODES as readonly string[]).includes(value)) return;
      setViewMode(value as ViewMode);
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, value);
        } catch {
          // preference persistence is best-effort
        }
      }
    },
    [storageKey],
  );
  return { viewMode, setViewMode, handleViewModeChange };
}
