'use client';

import { useMemo, memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import { Copy, Check } from 'lucide-react';
import {
  parseA2uiContent,
  legacyToA2uiMessages,
  thinkingToA2uiMessages,
  type ParsedA2uiBlock,
} from '@/lib/a2ui/parser';
import { A2uiSurfaceRenderer } from './a2ui-surface-renderer';

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
        className="text-primary hover:underline"
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
      <blockquote className="border-l-4 border-primary/50 pl-4 italic my-2">
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
            return block.content ? (
              <A2uiSurfaceRenderer
                key={key}
                messages={thinkingToA2uiMessages(block.content, key, isStreaming)}
                messageKey={key}
                isStreaming={isStreaming}
              />
            ) : null;

          case 'tool_call':
            return block.payload ? (
              <A2uiSurfaceRenderer
                key={key}
                messages={legacyToA2uiMessages(block.payload, key, true)}
                messageKey={key}
                isStreaming={isStreaming}
              />
            ) : null;

          case 'card':
            return block.payload ? (
              <A2uiSurfaceRenderer
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
