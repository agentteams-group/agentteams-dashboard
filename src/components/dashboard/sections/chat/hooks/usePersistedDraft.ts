'use client';

import { useCallback, useState } from 'react';

/**
 * Per-room composer draft persistence.
 *
 * The chat composer state survives room switches (ChatRoom is not remounted),
 * so without drafts a half-typed message would follow the user into the next
 * room and could be sent to the wrong place. This hook restores the saved
 * draft during render when `roomId` changes (the same adjust-state-during-
 * render pattern used by other dashboard poll handlers) and exposes a stable
 * `clear()` to wipe storage after a successful send.
 *
 * Falls back to an empty in-memory string when `localStorage` is unavailable
 * (Safari private mode, quota errors, etc.) — drafts are best-effort and
 * must never block the composer.
 */
export interface UsePersistedDraftResult {
  value: string;
  /** Set the draft and write it to storage. Whitespace-only drafts are not
   *  persisted (matches element-web behaviour). */
  setValue: (_next: string) => void;
  /** Replace the in-memory value without touching storage. Used when the
   *  composer is repurposed for an edit session — we do not want the
   *  in-flight edit body to leak into the room's draft on the next visit. */
  setValueLocal: (_next: string) => void;
  /** Reset both the in-memory value and the persisted draft. */
  clear: () => void;
}

export function usePersistedDraft(roomId: string): UsePersistedDraftResult {
  const draftKey = `agentteams-chat-draft:${roomId}`;
  const [value, setValueState] = useState<string>(() => readDraft(draftKey));

  const [prevRoomId, setPrevRoomId] = useState(roomId);
  if (prevRoomId !== roomId) {
    setPrevRoomId(roomId);
    setValueState(readDraft(`agentteams-chat-draft:${roomId}`));
  }

  const setValue = useCallback(
    (next: string) => {
      setValueState(next);
      writeDraft(`agentteams-chat-draft:${roomId}`, next);
    },
    [roomId],
  );

  const setValueLocal = useCallback((next: string) => {
    setValueState(next);
  }, []);

  const clear = useCallback(() => {
    setValueState('');
    clearDraft(`agentteams-chat-draft:${roomId}`);
  }, [roomId]);

  return { value, setValue, setValueLocal, clear };
}

function readDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(key: string, value: string): void {
  try {
    if (value.trim()) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable — best-effort */
  }
}

function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}