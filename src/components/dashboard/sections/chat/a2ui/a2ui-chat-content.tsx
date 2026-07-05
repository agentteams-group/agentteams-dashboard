'use client';

import { useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { sanitizeHtml } from '@/lib/utils';
import {
  parseA2uiContent,
  legacyToA2uiMessages,
  thinkingToA2uiMessages,
  type ParsedA2uiBlock,
} from '@/lib/a2ui/parser';
import { A2uiSurfaceRenderer } from './a2ui-surface-renderer';
import { StreamingCard } from '../streaming-card';
import { ThinkingCard } from '../thinking-card';

// ─── A2uiChatContent ─────────────────────────────────────────────────────────

interface A2uiChatContentProps {
  /** Plain text body from Matrix event */
  content: string;
  /** HTML formatted_body from Matrix event (optional) */
  formattedContent?: string;
  /** Whether this message is currently being streamed */
  isStreaming?: boolean;
  /** Message ID for unique surface keys */
  messageId: string;
}

/**
 * Renders Matrix message content using A2UI protocol.
 * Falls back to legacy rendering for non-A2UI content.
 */
export const A2uiChatContent = memo(function A2uiChatContent({
  content,
  formattedContent,
  isStreaming = false,
  messageId,
}: A2uiChatContentProps) {
  const result = useMemo(
    () => parseA2uiContent(content, formattedContent),
    [content, formattedContent]
  );

  if (result.hasA2ui) {
    return <A2uiBlocks blocks={result.blocks} messageId={messageId} isStreaming={isStreaming} />;
  }

  // Legacy format - use existing components with A2UI wrapping
  return <LegacyBlocks blocks={result.blocks} messageId={messageId} isStreaming={isStreaming} />;
});

// ─── A2uiBlocks ──────────────────────────────────────────────────────────────

const A2uiBlocks = memo(function A2uiBlocks({
  blocks,
  messageId,
  isStreaming,
}: {
  blocks: ParsedA2uiBlock[];
  messageId: string;
  isStreaming: boolean;
}) {
  return (
    <div className="space-y-1">
      {blocks.map((block, idx) => {
        const key = `${messageId}-block-${idx}`;

        switch (block.type) {
          case 'a2ui':
            return (
              <A2uiSurfaceRenderer
                key={key}
                messages={block.messages || []}
                messageKey={key}
                isStreaming={isStreaming}
              />
            );
          case 'text':
            return block.text ? (
              <div key={key} className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {block.text}
                </ReactMarkdown>
              </div>
            ) : null;
          default:
            return null;
        }
      })}
    </div>
  );
});

// ─── LegacyBlocks ────────────────────────────────────────────────────────────

const LegacyBlocks = memo(function LegacyBlocks({
  blocks,
  messageId,
  isStreaming,
}: {
  blocks: ParsedA2uiBlock[];
  messageId: string;
  isStreaming: boolean;
}) {
  return (
    <div className="space-y-1">
      {blocks.map((block, idx) => {
        const key = `${messageId}-block-${idx}`;

        switch (block.type) {
          case 'thinking':
            // Convert legacy thinking to A2UI messages
            return block.content ? (
              <A2uiSurfaceRenderer
                key={key}
                messages={thinkingToA2uiMessages(block.content, key, isStreaming)}
                messageKey={key}
                isStreaming={isStreaming}
              />
            ) : null;

          case 'tool_call':
            // Convert legacy tool_call to A2UI messages
            return block.payload ? (
              <A2uiSurfaceRenderer
                key={key}
                messages={legacyToA2uiMessages(block.payload, key, true)}
                messageKey={key}
                isStreaming={isStreaming}
              />
            ) : null;

          case 'card':
            // Convert legacy card to A2UI messages
            return block.payload ? (
              <A2uiSurfaceRenderer
                key={key}
                messages={legacyToA2uiMessages(block.payload, key, false)}
                messageKey={key}
                isStreaming={isStreaming}
              />
            ) : null;

          case 'text':
            return block.text ? (
              <div key={key} className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {block.text}
                </ReactMarkdown>
              </div>
            ) : null;

          default:
            return null;
        }
      })}
    </div>
  );
});
