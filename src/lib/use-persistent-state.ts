'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  Dispatch,
  SetStateAction,
} from 'react';

/**
 * `useState` with best-effort localStorage persistence, following the
 * use-view-mode convention: SSR renders `initial` and the stored value is
 * read **post-mount** (reading localStorage during render would desync the
 * client hydration from the server HTML). Writes are skipped silently when
 * storage is unavailable (private mode, quota, SSR).
 *
 * A value set **before mount** (e.g. a deep link consumed during the first
 * render) wins over the stored preference — an explicit navigation should
 * not be clobbered by a saved default.
 *
 * Values round-trip through JSON, so plain strings, null and numbers
 * persist as-is. Pass a `validate` type guard; stored values that fail it
 * are ignored (corrupt/legacy data falls back to `initial`).
 */
export function usePersistentState<T>(
  storageKey: string,
  initial: T,
  validate: (raw: unknown) => raw is T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial);
  const valueRef = useRef<T>(value);
  const mountedRef = useRef(false);
  const changedBeforeMountRef = useRef(false);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    mountedRef.current = true;
  }, []);

  useEffect(() => {
    if (changedBeforeMountRef.current) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        // Post-mount restore (use-view-mode pattern): one bounded setState,
        // validation-guarded, no-op when the stored value is invalid.
        if (validate(parsed)) setValue(parsed as T);
      }
    } catch {
      // storage unavailable or corrupt value — keep the default
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const setAndPersist = useCallback(
    (next: SetStateAction<T>) => {
      if (!mountedRef.current) changedBeforeMountRef.current = true;
      const resolved =
        typeof next === 'function'
          ? (next as (_prev: T) => T)(valueRef.current)
          : next;
      setValue(resolved);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(resolved));
      } catch {
        // persistence is best-effort — state still updates
      }
    },
    [storageKey],
  );

  return [value, setAndPersist];
}
