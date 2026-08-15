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
import { MermaidRenderer } from './mermaid-renderer';
import { mxcToDownloadUrl } from '@/lib/matrix-media';
import {
  renderFormattedContent,
  resolveMentionsInHtml,
  resolveMentionsToDisplayNames,
} from './format';

interface MarkdownMessageProps {
  content: string;
  formattedContent?: string | null;
  msgType?: string;
  mediaUrl?: string;
  mediaInfo?: { mimetype?: string; size?: number; w?: number; h?: number };
  homeserver?: string;
  memberMap?: Record<string, string>;
  /** Streaming placeholder path: lightweight text render + trailing cursor. */
  isStreaming?: boolean;
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

/** Block-level Markdown features that must keep the full renderer while streaming. */
function hasBlockFeatures(text: string): boolean {
  return (
    /(?:^|\n)\s*```/.test(text) ||
    /(?:^|\n)\s*#{1,6}\s/.test(text) ||
    /(?:^|\n)\s*>\s/.test(text) ||
    /(?:^|\n)\s*(?:[-*+]|\d+[.)])\s+/.test(text) ||
    /\|.*\|/.test(text) ||
    /\$\$/.test(text)
  );
}

/** GFM table separator row, e.g. "| --- | --- |" or "|:--|--:|". */
const GFM_SEPARATOR_ROW = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/m;

/** Whether the text carries a Markdown GFM table (pipe header + separator row). */
function hasMarkdownTable(text: string): boolean {
  return text.includes('|') && GFM_SEPARATOR_ROW.test(text);
}

/** Strips HTML markup so a formatted_body can be inspected as plain text. */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Trailing streaming cursor for the lightweight path. */
function StreamingCursor() {
  return (
    <span className="inline-block w-[0.4em] h-[1em] ml-0.5 align-text-bottom rounded-sm bg-current animate-pulse" />
  );
}

export function MarkdownMessage({ content, formattedContent, msgType, mediaUrl, mediaInfo, homeserver, memberMap, isStreaming }: MarkdownMessageProps) {
  // Resolve mxc:// URL to HTTP URL via Matrix media API
  const resolvedMediaUrl = useMemo(() => {
    return mxcToDownloadUrl(mediaUrl ?? '', homeserver);
  }, [mediaUrl, homeserver]);

  const html = useMemo(() => {
    if (formattedContent) {
      const formatted = renderFormattedContent(formattedContent, content).html;
      return resolveMentionsInHtml(
        formatted,
        memberMap,
        (name) => `<span class="matrix-mention text-emerald-600 font-medium">${name}</span>`
      );
    }
    return undefined;
  }, [formattedContent, content, memberMap]);

  const resolvedContent = useMemo(
    () => resolveMentionsToDisplayNames(content, memberMap),
    [content, memberMap]
  );

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
          className="flex items-center gap-2 text-sm text-emerald-600 hover:underline"
        >
          <span>📎</span>
          <span>{content}</span>
          {sizeText && <span className="text-xs text-muted-foreground">{sizeText}</span>}
        </a>
      </div>
    );
  }

  // For HTML formatted_body, render directly (card/thinking already split off
  // at the normalization layer, so a text block is plain HTML content).
  // Exception: some runtimes (e.g. openclaw) ship a formatted_body whose GFM
  // tables were never converted to <table> markup — the pipes are plain text
  // inside <p>/<br>. Rendering that as raw HTML shows literal pipes, so detect
  // the case (no real table element while the text has a Markdown table) and
  // fall through to the Markdown renderer below, where remark-gfm builds the
  // table.
  if (html) {
    const hasRealHtmlTable = /<table[\s>]/i.test(html);
    const mdTableOnly = !hasRealHtmlTable && hasMarkdownTable(htmlToPlainText(html));

    if (!mdTableOnly) {
      const mermaidChart = html.match(/```mermaid\n([\s\S]*?)\n```/);
      const hasMermaid = !!mermaidChart;

      if (isStreaming && !hasBlockFeatures(html) && !hasMermaid) {
        return (
          <div className="matrix-message-content text-sm whitespace-pre-wrap break-words">
            {content}
            <StreamingCursor />
          </div>
        );
      }

      // Ensure HTML tables carry the shared table styling (runtimes may send
      // bare <table> markup without any classes).
      const enhancedHtml = html.replace(
        /<table/g,
        '<table class="text-xs border-collapse border border-border"'
      ).replace(
        /<th/g,
        '<th class="border border-border px-2 py-1 bg-muted"'
      ).replace(
        /<td/g,
        '<td class="border border-border px-2 py-1"'
      );

      return (
        <div className="matrix-message-content text-sm space-y-1">
          {hasMermaid && <MermaidRenderer content={html} />}
          <div
            dangerouslySetInnerHTML={{ __html: enhancedHtml }}
            className="[&>p]:mb-1 [&>br]:block
              [&_a]:text-emerald-600 [&_a]:hover:underline
              [&_img]:max-w-full [&_img]:max-h-64 [&_img]:rounded-lg
              [&_pre]:bg-muted/50 [&_pre]:rounded-lg [&_pre]:p-3
              [&_code]:bg-muted/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded
              [&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-2 [&_h1]:mb-1
              [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1
              [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-1.5 [&_h3]:mb-0.5
              [&_h4]:text-sm [&_h4]:font-medium [&_h4]:mt-1 [&_h4]:mb-0.5
              [&_blockquote]:border-l-4 [&_blockquote]:border-emerald-500/50 [&_blockquote]:pl-4 [&_blockquote]:italic"
          />
        </div>
      );
    }
    // mdTableOnly → the Markdown renderer below owns this message.
  }

  const mermaidChart = resolvedContent.match(/```mermaid\n([\s\S]*?)\n```/);
  const hasMermaid = !!mermaidChart;
  const plainContent = hasMermaid ? resolvedContent.replace(/```mermaid\n[\s\S]*?\n```/g, '').trim() : resolvedContent;

  // Streaming lightweight path: no block-level features → plain pre + cursor.
  if (isStreaming && !hasBlockFeatures(plainContent) && !hasMermaid) {
    return (
      <div className="matrix-message-content text-sm">
        <pre className="whitespace-pre-wrap break-words m-0 font-inherit text-inherit">
          {plainContent}
          <StreamingCursor />
        </pre>
      </div>
    );
  }

  return (
    <div className="matrix-message-content text-sm space-y-1">
      {hasMermaid && <MermaidRenderer content={resolvedContent} />}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeHighlight, rehypeKatex]}
        components={{
          code({ className, children, ...props }) {
            const language = className?.replace('language-', '');
            const code = String(children).replace(/\n$/, '');
            if (className?.includes('language-')) {
              return <CodeBlock language={language}>{code}</CodeBlock>;
            }
            return (
              <code className="bg-muted px-1 py-0.5 rounded text-xs" {...props} />
            );
          },
          pre({ children }) {
            return <div className="my-1">{children}</div>;
          },
          p({ children }) {
            return <p className="mb-1 last:mb-0 leading-relaxed">{children}</p>;
          },
          h1({ children }) {
            return <h1 className="text-base font-semibold mt-2 mb-1 first:mt-0">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-sm font-semibold mt-1.5 mb-0.5 first:mt-0">{children}</h3>;
          },
          h4({ children }) {
            return <h4 className="text-sm font-medium mt-1 mb-0.5 first:mt-0">{children}</h4>;
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
                className="text-emerald-600 hover:underline"
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
              <blockquote className="border-l-4 border-emerald-500/50 pl-4 italic my-2">
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
        {plainContent}
      </ReactMarkdown>
    </div>
  );
}
