'use client';

import { useMemo } from 'react';
import type { MatrixEvent } from '@/lib/matrix-api';
import { assembleReplayTimeline } from '@/lib/replay/assemble-replay';
import { MessageBubble } from '@/components/dashboard/sections/chat/views/MessageBubble';
import type { AuditEventRecord } from '@/lib/audit-log';
import { parseAuditRef } from '@/lib/replay/audit-ref';
import { ShieldCheck } from 'lucide-react';

interface ReplayTimelineProps {
  events: MatrixEvent[];
  auditEvents?: AuditEventRecord[];
  highlightEventId?: string | null;
}

export function ReplayTimeline({
  events,
  auditEvents = [],
  highlightEventId,
}: ReplayTimelineProps) {
  const messages = useMemo(() => assembleReplayTimeline(events), [events]);

  // 构建各维度到审计事件的快速索引（D-2）
  const auditMatches = useMemo(() => {
    const map = new Map<string, AuditEventRecord>();
    for (const audit of auditEvents) {
      const ref = parseAuditRef(audit);
      if (ref.eventId) map.set(ref.eventId, audit);
      if (ref.confirmationId) map.set(ref.confirmationId, audit);
      if (ref.taskId) map.set(ref.taskId, audit);
    }
    return map;
  }, [auditEvents]);

  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
        该回放包中未包含可展示的时间线消息。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {messages.map((message, index) => {
        const prev = messages[index - 1];
        const isContinuation = Boolean(
          prev && prev.sender === message.sender && message.timestamp - prev.timestamp < 300_000,
        );
        const isHighlighted = Boolean(
          highlightEventId &&
            (message.id === highlightEventId ||
              message.eventId === highlightEventId ||
              message.canonicalEventId === highlightEventId ||
              message.sourceEventIds?.includes(highlightEventId)),
        );

        // 匹配该消息对应的 hitl.* 或 release.* 审计归因
        const relatedAudit =
          (message.id ? auditMatches.get(message.id) : undefined) ||
          (message.eventId ? auditMatches.get(message.eventId) : undefined) ||
          (message.canonicalEventId ? auditMatches.get(message.canonicalEventId) : undefined) ||
          auditEvents.find((a) => {
            if (!a.action.startsWith('hitl.') && !a.action.startsWith('release.')) return false;
            const delta = Math.abs(a.timestamp - message.timestamp);
            return delta < 5000;
          });

        return (
          <div
            key={message.id || message.eventId || index}
            id={message.id || message.eventId}
            className={`transition-colors rounded-lg ${
              isHighlighted ? 'bg-primary/5 ring-1 ring-primary/30 p-1.5' : ''
            }`}
          >
            <MessageBubble
              message={message}
              showSender={!isContinuation}
              isContinuation={isContinuation}
              currentUserId=""
              // 只读回放模式下不提供编辑/重发/删除等修改回调
            />
            {relatedAudit && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 border border-border/50 rounded-md px-2 py-0.5 w-fit">
                <ShieldCheck className="h-3 w-3 text-status-done shrink-0" aria-hidden />
                <span>
                  审计追溯：<strong className="font-medium text-foreground">{relatedAudit.actor ?? '系统'}</strong> ({relatedAudit.action}) · {new Date(relatedAudit.timestamp).toLocaleTimeString('zh-CN')}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
