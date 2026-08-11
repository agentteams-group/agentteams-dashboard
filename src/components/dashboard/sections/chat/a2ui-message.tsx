'use client';

import { useMemo } from 'react';
import { A2uiSurface } from '@a2ui/react/v0_9';
import { MessageProcessor, type A2uiMessage } from '@a2ui/web_core/v0_9';
import { agentteamsChatCatalog } from '@/lib/a2ui/catalog';
import { AlertTriangle } from 'lucide-react';

interface A2uiMessageProps {
  messages: A2uiMessage[];
}

export function A2uiMessage({ messages }: A2uiMessageProps) {
  // @a2ui/web_core 0.10.6 validates component props against the catalog schema
  // and throws on failure. Runtime-produced messages are untrusted input, so a
  // malformed one must never crash the message list — degrade to a notice.
  const { surfaces, failed } = useMemo(() => {
    try {
      const processor = new MessageProcessor([agentteamsChatCatalog]);
      processor.processMessages(messages);
      return {
        surfaces: Array.from(processor.model.surfacesMap.values()),
        failed: false,
      };
    } catch {
      // Catch any error type: the new validation branch reads a zod v3 shaped
      // `error.errors`, but our catalog bridges zod v4 which only exposes
      // `error.issues` — so a schema mismatch surfaces as an arbitrary type.
      return { surfaces: [], failed: true };
    }
  }, [messages]);

  if (failed) {
    return (
      <div className="a2ui-message my-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p>交互消息解析失败，已降级为文本</p>
          <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-muted-foreground/80">
            {JSON.stringify(messages)}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="a2ui-message my-2 min-w-0 space-y-2">
      {surfaces.map((surface) => (
        <A2uiSurface key={surface.id} surface={surface} />
      ))}
    </div>
  );
}
