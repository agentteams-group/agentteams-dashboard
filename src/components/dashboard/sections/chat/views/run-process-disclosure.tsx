'use client';

import { useId, useState } from 'react';
import { Brain, ChevronDown, ChevronRight, Loader2, TriangleAlert } from 'lucide-react';
import type { AttachmentPayload, ParsedA2uiBlock } from '@/lib/a2ui/parser';
import { AttachmentCard } from '../attachment-card';
import { ThinkingCard } from '../thinking-card';
import { StreamingCard } from '../streaming-card';
import { MarkdownMessage } from '../markdown-message';
import { ToolCallView, type ToolCallPayload } from './toolcalls';

interface RunProcessDisclosureProps {
  /** Contiguous thinking / tool-call blocks of one run segment. */
  blocks: ParsedA2uiBlock[];
  /** Message-level streaming flag, used when a block carries no own flag. */
  isStreaming?: boolean;
  /** Turn is still open (pending/running): keep progress visible. */
  active?: boolean;
  runtime?: string | null;
  eventId?: string;
  revisionCount?: number;
}

function toolPayloadOf(block: ParsedA2uiBlock): ToolCallPayload | null {
  if (block.type === 'tool_call') {
    return (block.payload ?? {}) as ToolCallPayload;
  }
  if (block.type === 'card') {
    const payload = block.payload as ToolCallPayload | undefined;
    if (payload && (payload.type === 'tool_call' || typeof payload.tool_name === 'string')) {
      return payload;
    }
  }
  return null;
}

/**
 * Process blocks are folded behind one disclosure per run segment. Interactive
 * output (confirmation cards, A2UI surfaces, final text) stays outside so a
 * collapsed process never hides something the human must act on.
 */
export function isProcessBlock(block: ParsedA2uiBlock): boolean {
  // Narrated steps (ChatIR marks qwenpaw thread text / earlier answer steps as
  // inProcess) belong inside the fold. Attachments stay outside so a
  // step-scoped file card remains visible next to its fold, unless the step
  // itself is a long-message narration (the attachment *is* its content).
  if (block.type === 'text') return block.inProcess === true;
  if (block.type === 'attachment') return block.inProcess === true;
  return block.type === 'thinking' || block.type === 'tool_call' || toolPayloadOf(block) !== null;
}

function isBlockRunning(block: ParsedA2uiBlock, messageStreaming: boolean): boolean {
  if (block.type === 'thinking') return (block.isStreaming ?? messageStreaming) === true;
  const payload = toolPayloadOf(block);
  if (!payload) return false;
  // Keyword-heuristic cards always claim `running`; that is a guess, not a
  // live signal, so it must not keep the finished fold open.
  if (payload.confidence === 'low') return false;
  const status = typeof payload.status === 'string' ? payload.status : '';
  if (block.isStreaming === true || payload.isStreaming === true) return true;
  if (status === 'running' || status === 'in_progress') return true;
  // Some parsers emit tool steps without status; while the message is still
  // streaming they count as in-flight unless a result already landed.
  return !status && messageStreaming && payload.result === undefined;
}

function isBlockFailed(block: ParsedA2uiBlock): boolean {
  const payload = toolPayloadOf(block);
  const status = typeof payload?.status === 'string' ? payload.status : '';
  return status === 'error' || status === 'failed';
}

export function RunProcessDisclosure({
  blocks,
  isStreaming,
  active,
  runtime,
  eventId,
  revisionCount,
}: RunProcessDisclosureProps) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const panelId = useId();

  const thinkingCount = blocks.filter((block) => block.type === 'thinking').length;
  const toolCount = blocks.filter((block) => toolPayloadOf(block) !== null).length;
  const failedCount = blocks.filter(isBlockFailed).length;
  const running = blocks.some((block) => isBlockRunning(block, isStreaming === true));
  // A live run that has only produced narration so far (qwenpaw answers by
  // editing its root placeholder at the very end) has no running block and no
  // answer. Without this it renders as a closed "过程" row and looks silent.
  const live = running || active === true;
  const open = userOpen ?? live;

  const parts: string[] = [];
  if (thinkingCount > 0) parts.push(`思考 ${thinkingCount}`);
  if (toolCount > 0) parts.push(`工具 ${toolCount}`);
  if (failedCount > 0) parts.push(`失败 ${failedCount}`);
  const detail = live ? '正在处理' : parts.join(' · ');

  return (
    <section
      className="my-1.5 w-full overflow-hidden rounded-lg border border-border/50 bg-muted/20"
      data-testid="run-process"
      data-state={open ? 'open' : 'closed'}
      data-steps={blocks.length}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setUserOpen((previous) => !(previous ?? live))}
      >
        {live ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-500" aria-hidden="true" />
        ) : (
          <Brain className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className="shrink-0 font-medium text-foreground/80">过程</span>
        <span className="min-w-0 truncate">{detail}</span>
        {failedCount > 0 && (
          <TriangleAlert className="h-3 w-3 shrink-0 text-red-500" aria-hidden="true" />
        )}
        {open ? (
          <ChevronDown className="ml-auto h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="ml-auto h-4 w-4 shrink-0" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div id={panelId} className="space-y-1.5 border-t border-border/40 px-2 py-2">
          {blocks.map((block, idx) => {
            if (block.type === 'thinking') {
              return (
                <ThinkingCard
                  key={`thinking-${idx}`}
                  content={block.content || ''}
                  isStreaming={block.isStreaming ?? isStreaming}
                  runtime={block.runtimeHint ?? runtime}
                  eventId={eventId}
                  revisionCount={revisionCount}
                  embedded
                />
              );
            }
            if (block.type === 'tool_call') {
              return (
                <ToolCallView
                  key={`tool-${idx}`}
                  payload={(block.payload ?? {}) as ToolCallPayload}
                  runtime={block.runtimeHint ?? runtime}
                  eventId={eventId}
                  revisionCount={revisionCount}
                  embedded
                />
              );
            }
            if (block.type === 'card') {
              return (
                <div key={`card-${idx}`} className="w-full [&>div]:my-0">
                  <StreamingCard payload={block.payload as Record<string, unknown>} />
                </div>
              );
            }
            if (block.type === 'text') {
              return (
                <div
                  key={`text-${idx}`}
                  className="custom-scrollbar max-h-72 w-full overflow-y-auto px-1 py-0.5 text-[12.5px] leading-relaxed"
                >
                  <MarkdownMessage content={block.text ?? ''} isStreaming={block.isStreaming ?? isStreaming} />
                </div>
              );
            }
            if (block.type === 'attachment' && block.payload) {
              return (
                <div key={`attachment-${idx}`} className="w-full">
                  <AttachmentCard payload={block.payload as unknown as AttachmentPayload} compact />
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </section>
  );
}
