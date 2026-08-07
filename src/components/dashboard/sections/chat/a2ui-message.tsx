'use client';

import { useMemo } from 'react';
import { A2uiSurface } from '@a2ui/react/v0_9';
import { MessageProcessor, type A2uiMessage } from '@a2ui/web_core/v0_9';
import { agentteamsChatCatalog } from '@/lib/a2ui/catalog';

interface A2uiMessageProps {
  messages: A2uiMessage[];
}

export function A2uiMessage({ messages }: A2uiMessageProps) {
  const surfaces = useMemo(() => {
    const processor = new MessageProcessor([agentteamsChatCatalog]);
    processor.processMessages(messages);
    return Array.from(processor.model.surfacesMap.values());
  }, [messages]);

  return (
    <div className="my-2 space-y-2">
      {surfaces.map((surface) => (
        <A2uiSurface key={surface.id} surface={surface} />
      ))}
    </div>
  );
}
