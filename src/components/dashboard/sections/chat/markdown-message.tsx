'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { StreamingCard } from './streaming-card';
import { ThinkingCard } from './thinking-card';
import { renderFormattedContent } from './format';

interface MarkdownMessageProps {
  content: string;
  formattedContent?: string | null;
  msgType?: string;
  mediaUrl?: string;
  mediaInfo?: { mimetype?: string; size?: number; w?: number; h?: number };
  homeserver?: string;
}

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
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleCopy}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </Button>
      </div>
      <pre className="p-3 overflow-x-auto m-0">
        <code className={`text-xs ${language ? `language-${language}` : ''}`}>{children}</code>
      </pre>
    </div>
  );
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'card'; payload: Record<string, unknown> }
  | { type: 'tool_call'; payload: Record<string, unknown> }
  | { type: 'thinking'; content: string };

function parseCustomBlocks(content: string): ContentPart[] {
  const parts: ContentPart[] = [];
  const regex = /(```card\n([\s\S]*?)\n```|&lt;details class="thinking"&gt;([\s\S]*?)&lt;\/details&gt;)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: content.slice(lastIndex, match.index) });
    }
    const full = match[0];
    if (full.startsWith('```card')) {
      try {
        const parsed = JSON.parse(match[2]);
        if (parsed.type === 'tool_call' || parsed.tool_name) {
          parts.push({ type: 'tool_call', payload: parsed });
        } else {
          parts.push({ type: 'card', payload: parsed });
        }
      } catch {
        parts.push({ type: 'text', text: full });
      }
    } else {
      parts.push({ type: 'thinking', content: match[3] });
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < content.length) {
    parts.push({ type: 'text', text: content.slice(lastIndex) });
  }
  return parts;
}

export function MarkdownMessage({ content, formattedContent, msgType, mediaUrl, mediaInfo, homeserver }: MarkdownMessageProps) {
  const source = formattedContent || content;

  // Resolve mxc:// URL to HTTP URL via Matrix media API
  const resolvedMediaUrl = useMemo(() => {
    if (!mediaUrl) return undefined;
    if (mediaUrl.startsWith('http')) return mediaUrl;
    // mxc:// URLs: convert to /_matrix/media/v3/download/serverName/mediaId
    if (mediaUrl.startsWith('mxc://')) {
      const parts = mediaUrl.replace('mxc://', '').split('/');
      if (parts.length >= 2) {
        const serverName = parts[0];
        const mediaId = parts.slice(1).join('/');
        // Use the homeserver as the base for media downloads
        const base = homeserver || '';
        return `${base}/_matrix/media/v3/download/${serverName}/${mediaId}`;
      }
    }
    return undefined;
  }, [mediaUrl, homeserver]);

  const html = useMemo(() => {
    if (formattedContent) {
      return renderFormattedContent(formattedContent, content).html;
    }
    return undefined;
  }, [formattedContent, content]);

  // Render media messages (m.image, m.file)
  if (msgType === 'm.image' && resolvedMediaUrl) {
    return (
      <div className="matrix-message-content">
        <img
          src={resolvedMediaUrl}
          alt={content}
          className="max-w-full max-h-64 rounded-lg object-contain"
          loading="lazy"
        />
        {content && <p className="text-xs text-muted-foreground mt-1">{content}</p>}
      </div>
    );
  }

  if (msgType === 'm.file' && resolvedMediaUrl) {
    const sizeText = mediaInfo?.size
      ? mediaInfo.size > 1024 * 1024
        ? `(${(mediaInfo.size / (1024 * 1024)).toFixed(1)} MB)`
        : `(${(mediaInfo.size / 1024).toFixed(1)} KB)`
      : '';
    return (
      <div className="matrix-message-content">
        <a
          href={resolvedMediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-orange-600 hover:underline"
        >
          <span>📎</span>
          <span>{content}</span>
          {sizeText && <span className="text-xs text-muted-foreground">{sizeText}</span>}
        </a>
      </div>
    );
  }

  // For HTML formatted_body, render with custom block parsing
  if (html) {
    const parts = parseCustomBlocks(html);
    return (
      <div className="matrix-message-content text-sm">
        {parts.map((part, idx) => {
          if (part.type === 'text') {
            return (
              <div
                key={idx}
                dangerouslySetInnerHTML={{ __html: part.text }}
                className="[&>p]:mb-1 [&>br]:block
                  [&_a]:text-orange-600 [&_a]:hover:underline
                  [&_img]:max-w-full [&_img]:max-h-64 [&_img]:rounded-lg
                  [&_pre]:bg-muted/50 [&_pre]:rounded-lg [&_pre]:p-3
                  [&_code]:bg-muted/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded
                  [&_table]:border-collapse [&_table]:border [&_table]:border-border
                  [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted
                  [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1
                  [&_blockquote]:border-l-4 [&_blockquote]:border-orange-500/50 [&_blockquote]:pl-4 [&_blockquote]:italic"
              />
            );
          }
          if (part.type === 'card') {
            return <StreamingCard key={idx} payload={part.payload} />;
          }
          if (part.type === 'tool_call') {
            return <StreamingCard key={idx} payload={part.payload} />;
          }
          return <ThinkingCard key={idx} content={part.content} />;
        })}
      </div>
    );
  }

  // For plain text / markdown body - enhanced with full format support
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeRaw, rehypeHighlight, rehypeKatex]}
      components={{
        code({ className, children, ...props }) {
          const language = className?.replace('language-', '');
          const code = String(children).replace(/\n$/, '');
          if (className?.includes('language-')) {
            return <CodeBlock language={language} children={code} />;
          }
          return (
            <code className="bg-muted px-1 py-0.5 rounded text-xs" {...props}>
              {children}
            </code>
          );
        },
        pre({ children }) {
          return <div className="my-1">{children}</div>;
        },
        p({ children }) {
          return <p className="mb-1 last:mb-0">{children}</p>;
        },
        ul({ children }) {
          return <ul className="list-disc pl-4 mb-1">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="list-decimal pl-4 mb-1">{children}</ol>;
        },
        li({ children }) {
          return <li className="mb-0.5">{children}</li>;
        },
        a({ href, children }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-600 hover:underline"
            >
              {children}
            </a>
          );
        },
        table({ children }) {
          return (
            <div className="overflow-x-auto my-2">
              <table className="text-xs border-collapse border border-border">{children}</table>
            </div>
          );
        },
        th({ children }) {
          return <th className="border border-border px-2 py-1 bg-muted">{children}</th>;
        },
        td({ children }) {
          return <td className="border border-border px-2 py-1">{children}</td>;
        },
        blockquote({ children }) {
          return (
            <blockquote className="border-l-4 border-orange-500/50 pl-4 italic my-2">
              {children}
            </blockquote>
          );
        },
        hr() {
          return <hr className="border-border my-2" />;
        },
        img({ src, alt }) {
          return (
            <img
              src={src}
              alt={alt}
              className="max-w-full max-h-64 rounded-lg object-contain my-2"
              loading="lazy"
            />
          );
        },
        details({ children }) {
          return (
            <details className="my-2 rounded-lg border border-border/50 overflow-hidden">
              {children}
            </details>
          );
        },
        summary({ children }) {
          return (
            <summary className="px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors text-sm font-medium">
              {children}
            </summary>
          );
        },
        // Task list support (from remark-gfm)
        input({ type, checked, ...props }) {
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
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
