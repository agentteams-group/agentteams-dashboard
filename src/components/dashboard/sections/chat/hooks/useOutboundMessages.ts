'use client';

import { useCallback, useRef, useState } from 'react';
import {
  useMatrixSendMessage,
  type DisplayMessage,
} from '@/hooks/use-matrix';
import { MatrixRequestError, getRateLimitRetryDelay } from '@/lib/matrix-api';
import { FILE_REFS_CONTENT_KEY, type FileRef } from '@/lib/file-refs';
import { buildAnswerContent, type ConfirmationAnswerField } from '../confirmation-reply';
import { type LocalOutboundMessage, type ChatSystemNotice } from '../structures/MessageList';
import type { MentionEntry } from '../chat-composer';

interface UseOutboundMessagesParams {
  roomId: string;
  isLoggedIn: boolean;
  userId: string | null;
  sendMutation: ReturnType<typeof useMatrixSendMessage>;
  markAllRead: (_targetOverride?: string) => void;
}

export function useOutboundMessages({
  roomId,
  isLoggedIn,
  userId,
  sendMutation,
  markAllRead,
}: UseOutboundMessagesParams) {
  const [localMessages, setLocalMessages] = useState<LocalOutboundMessage[]>([]);
  const [systemNotices, setSystemNotices] = useState<ChatSystemNotice[]>([]);
  const noticeCounterRef = useRef(0);
  const localCounterRef = useRef(0);

  const removeLocal = useCallback((clientId: string) => {
    setLocalMessages(prev => prev.filter(m => m.clientId !== clientId));
  }, []);

  const pushLocal = useCallback((message: LocalOutboundMessage) => {
    setLocalMessages(prev => [...prev, message]);
  }, []);

  const patchLocal = useCallback((clientId: string, patch: Partial<LocalOutboundMessage>) => {
    setLocalMessages(prev => prev.map(m => m.clientId === clientId ? { ...m, ...patch } : m));
  }, []);

  const pushSystemNotice = useCallback((notice: ChatSystemNotice) => {
    setSystemNotices(prev => {
      // De-duplicate on identical messages: refresh the countdown instead of
      // stacking an endless pile of banners on repeated throttling.
      const existing = prev.find(n => n.kind === notice.kind && n.message === notice.message);
      if (existing) {
        return prev.map(n =>
          n.id === existing.id
            ? { ...n, createdAt: Date.now(), retryAfterMs: notice.retryAfterMs, autoRetry: notice.autoRetry }
            : n
        );
      }
      return [...prev, notice];
    });
  }, []);

  const sendOutbound = useCallback((params: {
    content: string;
    options?: { html?: boolean };
    mentions?: MentionEntry[];
    replyTo?: DisplayMessage | null;
    clientId?: string;
    msgtype?: string;
    /** Workspace file references attached to this message (#87). */
    fileRefs?: FileRef[];
    /** Card event this reply answers (HITL correlation via m.reference). */
    referenceEventId?: string;
    /** 干预卡的结构化答复（方案 v3 C-3），并进 content 的自定义字段。 */
    answer?: ConfirmationAnswerField;
  }): Promise<boolean> => {
    // 返回值 = 「这条消息是否真的进了房间」。干预卡靠它决定该不该翻成已答复，
    // 所以未登录 / 没有房间时也必须是明确的 false，而不是 undefined。
    if (!roomId || !isLoggedIn || !userId) return Promise.resolve(false);
    const {
      content, options, mentions, replyTo, clientId, msgtype, fileRefs, referenceEventId, answer,
    } = params;

    // Only mentions that still appear in the final text are sent (the user may
    // have typed more after inserting them, or deleted the placeholder again).
    const activeMentions = (mentions ?? []).filter((m) => content.includes(m.placeholder));
    const mentionUserIds = activeMentions.map(m => m.userId);
    const mentionData = mentionUserIds.length > 0
      ? { 'm.mentions': { user_ids: mentionUserIds } }
      : {};

    // Build a Matrix-compatible formatted body with clickable mention links
    // (https://matrix.to/#/userId). Without these the receiver only sees the
    // raw "@name" text and the mention is not actionable.
    let formattedBody: string | undefined = options?.html ? content : undefined;
    if (activeMentions.length > 0) {
      let body = formattedBody ?? content;
      for (const m of activeMentions) {
        const link = `<a href="https://matrix.to/#/${encodeURIComponent(m.userId)}">${m.displayName}</a>`;
        body = body.replaceAll(m.placeholder, link);
      }
      formattedBody = body;
    }
    const cid = clientId ?? `local-${Date.now()}-${++localCounterRef.current}`;

    // First attempt renders an optimistic "sending" bubble; a retry keeps the
    // existing entry and flips it back to sending.
    if (!clientId) {
      setLocalMessages(prev => [...prev, {
        clientId: cid,
        sender: userId,
        senderShort: userId.startsWith('@') ? userId.split(':')[0].slice(1) : userId,
        content,
        formattedContent: formattedBody ?? (options?.html ? content : undefined),
        mentions,
        replyTo,
        fileRefs,
        timestamp: Date.now(),
        status: 'sending' as const,
      }]);
    }

    return new Promise<boolean>((resolve) => {
    sendMutation.mutate(
      {
        roomId,
        body: content,
        formattedBody,
        extra: {
          ...mentionData,
          ...(msgtype ? { msgtype } : {}),
          ...(fileRefs && fileRefs.length > 0 ? { [FILE_REFS_CONTENT_KEY]: { refs: fileRefs } } : {}),
          ...buildAnswerContent(answer),
        },
        relatesTo: replyTo
          ? { 'm.in_reply_to': { event_id: replyTo.eventId || replyTo.id } }
          : referenceEventId
            ? { rel_type: 'm.reference', event_id: referenceEventId }
            : undefined,
      },
      {
        onSuccess: (data) => {
          removeLocal(cid);
          // Sending a message advances the read position to the sent event.
          markAllRead(data?.event_id);
          resolve(true);
        },
        onError: (err) => {
          patchLocal(cid, { status: 'error', error: err.message });
          pushSystemNotice(buildSystemNoticeFromError(err, { content, mentions, replyTo, referenceEventId, answer }, ++noticeCounterRef.current));
          // 失败不 reject：调用方都是 fire-and-forget，reject 会变成未处理的
          // Promise rejection；用 false 让干预卡能显示「未写入房间」并允许重试。
          resolve(false);
        },
      }
    );
    });
  }, [roomId, isLoggedIn, userId, sendMutation, removeLocal, patchLocal, pushSystemNotice, markAllRead]);

  const removeSystemNotice = useCallback((notice: ChatSystemNotice) => {
    setSystemNotices(prev => prev.filter(n => n.id !== notice.id));
  }, []);

  const handleRetryNotice = useCallback((notice: ChatSystemNotice) => {
    const payload = notice.retryPayload;
    setSystemNotices(prev => prev.filter(n => n.id !== notice.id));
    if (payload && roomId && isLoggedIn && userId) {
      sendOutbound({ content: payload.content, mentions: payload.mentions, replyTo: payload.replyTo, referenceEventId: payload.referenceEventId, answer: payload.answer });
    }
  }, [sendOutbound, roomId, isLoggedIn, userId]);

  return {
    localMessages,
    systemNotices,
    pushLocal,
    patchLocal,
    removeLocal,
    pushSystemNotice,
    removeSystemNotice,
    sendOutbound,
    handleRetryNotice,
    buildSystemNotice: buildSystemNoticeFromError,
  };
}

function buildSystemNoticeFromError(
  err: unknown,
  payload: { content: string; mentions?: MentionEntry[]; replyTo?: DisplayMessage | null; referenceEventId?: string; answer?: ConfirmationAnswerField },
  id: number
): ChatSystemNotice {
  const retryAfterMs = getRateLimitRetryDelay(err);
  const isRateLimited = err instanceof MatrixRequestError && err.isRateLimited;
  if (isRateLimited) {
    return {
      id,
      kind: 'rate-limited',
      message: `消息发送失败：服务商限流中，${Math.ceil(retryAfterMs / 1000)} 秒后自动重试`,
      createdAt: Date.now(),
      retryAfterMs,
      autoRetry: true,
      retryPayload: payload,
    };
  }
  return {
    id,
    kind: 'error',
    message: `消息发送失败：${err instanceof Error ? err.message : '未知错误'}`,
    createdAt: Date.now(),
    autoRetry: false,
    retryPayload: payload,
  };
}
