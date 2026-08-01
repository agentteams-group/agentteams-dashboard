'use client';

import { useMemo, memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import { Copy, Check, ShieldAlert, Terminal, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  parseA2uiContent,
  legacyToA2uiMessages,
  thinkingToA2uiMessages,
  type ParsedA2uiBlock,
} from '@/lib/a2ui/parser';
import { IncrementalA2uiRenderer } from './a2ui-surface-renderer';

// ─── Code Block Component ────────────────────────────────────────────────────

function CodeBlock({ language, children }: { language?: string; children: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-2 rounded-lg overflow-hidden border bg-muted/50">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted text-xs text-muted-foreground">
        <span>{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs hover:text-foreground"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto m-0">
        <code className={`text-xs ${language ? `language-${language}` : ''}`}>{children}</code>
      </pre>
    </div>
  );
}

// ─── Markdown Renderer Component ─────────────────────────────────────────────

const markdownComponents = {
  code({ className, children, ...props }: React.HTMLAttributes<HTMLElement> & { className?: string }) {
    const language = className?.replace('language-', '');
    const code = String(children).replace(/\n$/, '');
    if (className?.includes('language-')) {
      return <CodeBlock language={language}>{code}</CodeBlock>;
    }
    return (
      <code className="bg-muted px-1 py-0.5 rounded text-xs" {...props}>
        {children}
      </code>
    );
  },
  pre({ children }: React.HTMLAttributes<HTMLPreElement>) {
    return <div className="my-1">{children}</div>;
  },
  p({ children }: React.HTMLAttributes<HTMLParagraphElement>) {
    return <p className="mb-1 last:mb-0">{children}</p>;
  },
  ul({ children }: React.HTMLAttributes<HTMLUListElement>) {
    return <ul className="list-disc pl-4 mb-1">{children}</ul>;
  },
  ol({ children }: React.OlHTMLAttributes<HTMLOListElement>) {
    return <ol className="list-decimal pl-4 mb-1">{children}</ol>;
  },
  li({ children }: React.HTMLAttributes<HTMLLIElement>) {
    return <li className="mb-0.5">{children}</li>;
  },
  a({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-emerald-600 hover:underline"
      >
        {children}
      </a>
    );
  },
  table({ children }: React.HTMLAttributes<HTMLTableElement>) {
    return (
      <div className="overflow-x-auto my-2">
        <table className="text-xs border-collapse border border-border">{children}</table>
      </div>
    );
  },
  th({ children }: React.ThHTMLAttributes<HTMLTableCellElement>) {
    return <th className="border border-border px-2 py-1 bg-muted">{children}</th>;
  },
  td({ children }: React.TdHTMLAttributes<HTMLTableCellElement>) {
    return <td className="border border-border px-2 py-1">{children}</td>;
  },
  blockquote({ children }: React.BlockquoteHTMLAttributes<HTMLElement>) {
    return (
      <blockquote className="border-l-4 border-emerald-500/50 pl-4 italic my-2">
        {children}
      </blockquote>
    );
  },
  hr() {
    return <hr className="border-border my-2" />;
  },
  img({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) {
    return (
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-64 rounded-lg object-contain my-2"
        loading="lazy"
      />
    );
  },
  details({ children }: React.DetailsHTMLAttributes<HTMLDetailsElement>) {
    return (
      <details className="my-2 rounded-lg border border-border/50 overflow-hidden">
        {children}
      </details>
    );
  },
  summary({ children }: React.HTMLAttributes<HTMLElement>) {
    return (
      <summary className="px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors text-sm font-medium">
        {children}
      </summary>
    );
  },
  // Task list support (from remark-gfm)
  input({ type, checked, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
    if (type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={checked}
          readOnly
          className="mr-1 rounded border-border"
          {...props}
        />
      );
    }
    return <input type={type} {...props} />;
  },
};

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeHighlight, rehypeKatex]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function hasMarkdownStructure(content: string): boolean {
  return /(^|\n)(```|>\s|\s*[-*+]\s|\s*\d+\.\s|#{1,6}\s|\|)/.test(content);
}

function StreamingTextContent({ content }: { content: string }) {
  return (
    <div className="whitespace-pre-wrap break-words leading-relaxed">
      {content}
      <span className="inline-block h-4 w-1.5 translate-y-0.5 bg-foreground/60 animate-pulse ml-0.5" />
    </div>
  );
}

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
  /** Sends a response defined by a recognized runtime confirmation protocol. */
  onConfirmationReply?: (_reply: string) => Promise<void>;
}

/**
 * Renders Matrix message content with support for:
 * - A2UI protocol messages (thinking, tool calls, streaming)
 * - HTML formatted_body (sanitized)
 * - Markdown with GFM, math, code highlighting
 * - Legacy card/thinking blocks
 */
export const A2uiChatContent = memo(function A2uiChatContent({
  content,
  formattedContent,
  isStreaming = false,
  messageId,
  onConfirmationReply,
}: A2uiChatContentProps) {
  const useStreamingText = isStreaming
    && content.length > 0
    && !hasMarkdownStructure(content)
    && !content.includes('<!--a2ui:')
    && !content.includes('```a2ui');

  if (useStreamingText) {
    return <StreamingTextContent content={content} />;
  }

  return <ParsedChatContent
    content={content}
    formattedContent={formattedContent}
    isStreaming={isStreaming}
    messageId={messageId}
    onConfirmationReply={onConfirmationReply}
  />;
});

const ParsedChatContent = memo(function ParsedChatContent({
  content,
  formattedContent,
  isStreaming = false,
  messageId,
  onConfirmationReply,
}: A2uiChatContentProps) {
  const result = useMemo(
    () => parseA2uiContent(content, formattedContent),
    [content, formattedContent]
  );

  if (result.hasA2ui) {
    return <A2uiBlocks blocks={result.blocks} messageId={messageId} isStreaming={isStreaming} />;
  }

  // Legacy format - use existing components with A2UI wrapping
  return <LegacyBlocks blocks={result.blocks} messageId={messageId} isStreaming={isStreaming} onConfirmationReply={onConfirmationReply} />;
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
              <IncrementalA2uiRenderer
                key={key}
                messages={block.messages || []}
                messageKey={key}
                isStreaming={isStreaming}
              />
            );
          case 'text':
            return block.text ? <MarkdownContent key={key} content={block.text} /> : null;
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
  onConfirmationReply,
}: {
  blocks: ParsedA2uiBlock[];
  messageId: string;
  isStreaming: boolean;
  onConfirmationReply?: (_reply: string) => Promise<void>;
}) {
  return (
    <div className="space-y-1">
      {blocks.map((block, idx) => {
        const key = `${messageId}-block-${idx}`;

        switch (block.type) {
          case 'thinking':
            return block.content ? (
              <IncrementalA2uiRenderer
                key={key}
                messages={thinkingToA2uiMessages(block.content, key, isStreaming)}
                messageKey={key}
                isStreaming={isStreaming}
              />
            ) : null;

          case 'tool_call':
            return block.payload ? (
              <IncrementalA2uiRenderer
                key={key}
                messages={legacyToA2uiMessages(block.payload, key, true)}
                messageKey={key}
                isStreaming={isStreaming}
              />
            ) : null;

          case 'confirmation':
            return block.payload ? (
              <ToolGuardConfirmationCard
                key={key}
                payload={block.payload}
                onReply={onConfirmationReply}
              />
            ) : null;

          case 'card':
            return block.payload ? (
              <IncrementalA2uiRenderer
                key={key}
                messages={legacyToA2uiMessages(block.payload, key, false)}
                messageKey={key}
                isStreaming={isStreaming}
              />
            ) : null;

          case 'text':
            return block.text ? <MarkdownContent key={key} content={block.text} /> : null;

          default:
            return null;
        }
      })}
    </div>
  );
});

function ToolGuardConfirmationCard({
  payload,
  onReply,
}: {
  payload: Record<string, unknown>;
  onReply?: (_reply: string) => Promise<void>;
}) {
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isSubmitting = reply !== null && reply !== 'sent';
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : '未知工具';
  const triggeredBy = typeof payload.triggeredBy === 'string' ? payload.triggeredBy : undefined;
  const parameters = typeof payload.parameters === 'string' ? payload.parameters : undefined;
  const externalFiles = typeof payload.externalFiles === 'string' ? payload.externalFiles : undefined;

  const submit = async (nextReply: string) => {
    if (!onReply || reply) return;
    setReply(nextReply);
    setError(null);
    try {
      await onReply(nextReply);
      setReply('sent');
    } catch {
      setReply(null);
      setError('回复发送失败，请重试。');
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-start gap-2 border-b border-amber-500/20 px-3 py-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">等待审批</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">工具护栏请求确认后执行操作</p>
        </div>
      </div>
      <div className="space-y-2 px-3 py-3 text-xs">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">工具</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{toolName}</code>
        </div>
        {triggeredBy && <p className="text-muted-foreground">触发来源：{triggeredBy}</p>}
        {parameters && (
          <div>
            <p className="mb-1 text-muted-foreground">参数</p>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/60 p-2 text-[11px]">{parameters}</pre>
          </div>
        )}
        {externalFiles && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-amber-800 dark:text-amber-200">
            <p className="font-medium">检测到工作区外文件</p>
            <pre className="mt-1 whitespace-pre-wrap text-[11px]">{externalFiles}</pre>
          </div>
        )}
        {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
        {reply === 'sent' ? (
          <p className="font-medium text-emerald-600 dark:text-emerald-400">已发送回复，等待运行时处理。</p>
        ) : (
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="h-7 text-xs" disabled={!onReply || isSubmitting} onClick={() => submit('/approve')}>
              {isSubmitting && reply === '/approve' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              批准
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!onReply || isSubmitting} onClick={() => submit('拒绝')}>
              {isSubmitting && reply === '拒绝' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              拒绝
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
