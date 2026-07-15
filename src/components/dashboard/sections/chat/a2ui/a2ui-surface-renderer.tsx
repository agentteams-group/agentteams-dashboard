'use client';

import { useState, useEffect, useRef, memo } from 'react';
import { MessageProcessor, Catalog } from '@a2ui/web_core/v0_9';
import { A2uiSurface, basicCatalog, type ReactComponentImplementation } from '@a2ui/react/v0_9';
import type { A2uiMessage } from '@a2ui/web_core/v0_9';
import { agentteamsChatCatalog } from '@/lib/a2ui/catalog';

// Merge the basic catalog with our custom chat catalog
const mergedComponents = new Map([
  ...basicCatalog.components,
  ...agentteamsChatCatalog.components,
]);
const mergedFunctions = new Map([
  ...basicCatalog.functions,
  ...agentteamsChatCatalog.functions,
]);

// Create a merged catalog
const chatCatalog = new Catalog<ReactComponentImplementation>(
  'agentteams-chat-merged',
  Array.from(mergedComponents.values()),
  Array.from(mergedFunctions.values())
);

// ─── A2uiSurfaceRenderer ─────────────────────────────────────────────────────

interface A2uiSurfaceRendererProps {
  /** A2UI protocol messages to render */
  messages: A2uiMessage[];
  /** Unique key for this message block (used as surface ID prefix) */
  messageKey: string;
  /** Whether new messages may arrive (streaming mode) */
  isStreaming?: boolean;
}

/**
 * Renders A2UI protocol messages as React surfaces inline in chat bubbles.
 * Each message block gets its own MessageProcessor and surface.
 */
export const A2uiSurfaceRenderer = memo(function A2uiSurfaceRenderer({
  messages,
  messageKey,
  isStreaming = false,
}: A2uiSurfaceRendererProps) {
  const processorRef = useRef<MessageProcessor<ReactComponentImplementation> | null>(null);
   
  const [surfaces, setSurfaces] = useState<Array<{ id: string; surface: any }>>([]);

  // Initialize processor and process messages
  useEffect(() => {
    if (!messages || messages.length === 0) return;

    // Create processor if not exists
    if (!processorRef.current) {
      processorRef.current = new MessageProcessor<ReactComponentImplementation>([chatCatalog]);
    }

    const processor = processorRef.current;

    // Process all messages
    try {
      processor.processMessages(messages);
    } catch (err) {
      console.error('[A2UI] Failed to process messages:', err);
    }

    // Sync surfaces
    const sync = () => {
       
      const list: Array<{ id: string; surface: any }> = [];
      processor.model.surfacesMap.forEach((surface: unknown, id: string) => {
        if (surface) list.push({ id, surface });
      });
      setSurfaces(list);
    };

    sync();

    // Subscribe to surface changes
    const createdSub = processor.onSurfaceCreated(sync);
    const deletedSub = processor.onSurfaceDeleted(sync);

    return () => {
      createdSub.unsubscribe();
      deletedSub.unsubscribe();
    };
  }, [messages]);

  if (!messages || messages.length === 0) return null;

  return (
    <div className="a2ui-chat-content">
      {surfaces.map(({ id, surface }) => (
        <div key={`${messageKey}-${id}`} className="a2ui-surface-container">
          <A2uiSurface surface={surface} />
        </div>
      ))}
      {isStreaming && surfaces.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2 animate-pulse">
          <div className="w-2 h-2 rounded-full bg-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 rounded-full bg-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 rounded-full bg-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      )}
    </div>
  );
});

// ─── IncrementalA2uiRenderer ─────────────────────────────────────────────────

interface IncrementalA2uiRendererProps {
  /** All A2UI messages received so far */
  messages: A2uiMessage[];
  /** Unique key for this message block */
  messageKey: string;
}

/**
 * Incremental A2UI renderer for streaming scenarios.
 * Processes messages incrementally as they arrive, without re-creating the processor.
 */
export const IncrementalA2uiRenderer = memo(function IncrementalA2uiRenderer({
  messages,
  messageKey,
}: IncrementalA2uiRendererProps) {
  const processorRef = useRef<MessageProcessor<ReactComponentImplementation> | null>(null);
  const processedCountRef = useRef(0);
   
  const [surfaces, setSurfaces] = useState<Array<{ id: string; surface: any }>>([]);

  useEffect(() => {
    if (!messages || messages.length === 0) return;

    // Create processor on first call
    if (!processorRef.current) {
      processorRef.current = new MessageProcessor<ReactComponentImplementation>([chatCatalog]);
    }

    const processor = processorRef.current;
    const startIndex = processedCountRef.current;

    // Only process new messages
    if (startIndex < messages.length) {
      const newMessages = messages.slice(startIndex);
      try {
        processor.processMessages(newMessages);
        processedCountRef.current = messages.length;
      } catch (err) {
        console.error('[A2UI] Failed to process incremental messages:', err);
      }
    }

    // Sync surfaces
    const sync = () => {
       
      const list: Array<{ id: string; surface: any }> = [];
      processor.model.surfacesMap.forEach((surface: unknown, id: string) => {
        if (surface) list.push({ id, surface });
      });
      setSurfaces(list);
    };

    sync();

    const createdSub = processor.onSurfaceCreated(sync);
    const deletedSub = processor.onSurfaceDeleted(sync);

    return () => {
      createdSub.unsubscribe();
      deletedSub.unsubscribe();
    };
  }, [messages]);

  // Reset when messageKey changes
  useEffect(() => {
    processorRef.current = null;
    processedCountRef.current = 0;
    setSurfaces([]);
  }, [messageKey]);

  return (
    <div className="a2ui-chat-content">
      {surfaces.map(({ id, surface }) => (
        <div key={`${messageKey}-${id}`} className="a2ui-surface-container">
          <A2uiSurface surface={surface} />
        </div>
      ))}
    </div>
  );
});
