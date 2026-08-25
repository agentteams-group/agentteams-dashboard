'use client';

import { useCallback, useState } from 'react';
import type { ChatSystemNotice, LocalOutboundMessage } from '../structures/MessageList';

/**
 * File upload to the Matrix homeserver, then send it as an `m.image` /
 * `m.file` message so it appears in the room timeline like any other
 * message. Extracted from ChatRoom so the upload state machine is unit
 * testable independently of the surrounding UI.
 *
 * The hook owns:
 *   - `isUploading` flag (rendering the spinner)
 *   - Optimistic local message lifecycle (sending → sent → error)
 *   - System notice emission when the upload or send fails
 *
 * It delegates the actual transport to the caller-supplied mutations so the
 * hook stays free of `use-matrix`/`useMatrixStore` imports (easier testing,
 * no React context fan-out).
 */

export interface UseFileUploadInput {
  roomId: string;
  isLoggedIn: boolean;
  userId: string | null;
  /** Async resolver for the upload step — typically `useMatrixUploadMedia`. */
  upload: (_input: { roomId: string; file: File }) => Promise<{ content_uri: string }>;
  /** Fires the final send. `onSuccess`/`onError` let the caller mutate local
   *  message state and propagate errors to the user. */
  send: (
    _args: { roomId: string; body: string; extra: Record<string, unknown> },
    _callbacks: {
      onSuccess: () => void;
      onError: (_err: Error) => void;
    },
  ) => void;
  /** Push / patch / remove optimistic local messages. */
  pushLocal: (_message: LocalOutboundMessage) => void;
  patchLocal: (_clientId: string, _patch: Partial<LocalOutboundMessage>) => void;
  removeLocal: (_clientId: string) => void;
  /** Emit a system notice (e.g. rate limit, network failure). */
  pushSystemNotice: (_notice: ChatSystemNotice) => void;
  /** Build a system notice from a thrown error (kept as a callback so the
   *  hook does not import the builder directly and stays host-agnostic). */
  buildSystemNotice: (
    _err: unknown,
    _payload: {
      content: string;
      mentions?: import('../chat-composer').MentionEntry[];
      replyTo?: import('@/hooks/use-matrix').DisplayMessage | null;
    },
    _counter: number,
  ) => ChatSystemNotice;
}

export interface UseFileUploadResult {
  isUploading: boolean;
  upload: (_file: File) => Promise<void>;
}

export function useFileUpload(input: UseFileUploadInput): UseFileUploadResult {
  const [isUploading, setIsUploading] = useState(false);
  const [noticeCounter, setNoticeCounter] = useState(0);

  const upload = useCallback(
    async (file: File) => {
      if (!input.roomId || !input.isLoggedIn || !input.userId) return;
      setIsUploading(true);
      const cid = `local-${Date.now()}-${noticeCounter}`;
      const isImage = file.type.startsWith('image/');
      input.pushLocal({
        clientId: cid,
        sender: input.userId,
        senderShort: input.userId.startsWith('@')
          ? input.userId.split(':')[0].slice(1)
          : input.userId,
        content: file.name,
        timestamp: Date.now(),
        status: 'sending',
      });
      try {
        const { content_uri } = await input.upload({ roomId: input.roomId, file });
        const extra: Record<string, unknown> = {
          msgtype: isImage ? 'm.image' : 'm.file',
          url: content_uri,
          info: {
            mimetype: file.type || 'application/octet-stream',
            size: file.size,
          },
        };
        input.send(
          { roomId: input.roomId, body: file.name, extra },
          {
            onSuccess: () => input.removeLocal(cid),
            onError: (err) => {
              input.patchLocal(cid, { status: 'error', error: err.message });
              const next = noticeCounter + 1;
              setNoticeCounter(next);
              input.pushSystemNotice(input.buildSystemNotice(err, { content: file.name }, next));
            },
          },
        );
      } catch (err) {
        input.patchLocal(cid, {
          status: 'error',
          error: err instanceof Error ? err.message : '上传失败',
        });
        const next = noticeCounter + 1;
        setNoticeCounter(next);
        input.pushSystemNotice(input.buildSystemNotice(err, { content: file.name }, next));
      } finally {
        setIsUploading(false);
      }
    },
    [input, noticeCounter],
  );

  return { isUploading, upload };
}