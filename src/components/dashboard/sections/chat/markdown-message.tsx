'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import { Copy, Check, Download, FileText, Play, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MermaidRenderer } from './mermaid-renderer';
import { MediaViewer } from './media-viewer';
import { mxcToDownloadUrl } from '@/lib/matrix-media';
import { useMatrixStore } from '@/lib/matrix-store';
import {
  renderFormattedContent,
  resolveMentionsInHtml,
  resolveMentionsToDisplayNames,
} from './format';
import { unwrapFencedTables, convertFencedTablesInHtml } from './fenced-table';

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

/** Typing effect: reveals text character by character during streaming. */
function TypingEffect({ text, speed }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState('');
  const idx = useRef(0);

  useEffect(() => {
    setDisplayed('');
    idx.current = 0;
  }, [text]);

  useEffect(() => {
    if (idx.current >= text.length) return;
    const timer = setTimeout(() => {
      idx.current += 1;
      setDisplayed(text.slice(0, idx.current));
    }, speed ?? 12);
    return () => clearTimeout(timer);
  }, [text, speed, displayed.length]);

  return (
    <span>
      {displayed}
      <span className="inline-block w-[0.4em] h-[1em] ml-0.5 align-text-bottom rounded-sm bg-current animate-pulse" />
    </span>
  );
}

/** Bare mxc:// URIs in plain-text bodies → clickable markdown download links. */
function linkifyMxcUris(text: string, homeserver?: string): string {
  if (!text.includes('mxc://')) return text;
  return text.replace(/mxc:\/\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)/g, (match) => {
    const url = mxcToDownloadUrl(match, homeserver, { download: true });
    return url ? `[${match}](${url})` : match;
  });
}

function formatFileSize(size?: number): string {
  if (!size) return '';
  if (size > 1024 * 1024) return `(${(size / (1024 * 1024)).toFixed(1)} MB)`;
  return `(${(size / 1024).toFixed(1)} KB)`;
}

export function MarkdownMessage({ content, formattedContent, msgType, mediaUrl, mediaInfo, homeserver, memberMap, isStreaming }: MarkdownMessageProps) {
  // Prop takes precedence; fall back to the logged-in homeserver from the
  // store so media URLs resolve even when the caller omits the prop.
  const { homeserver: storeHomeserver } = useMatrixStore();
  const resolvedHomeserver = homeserver || storeHomeserver;
  // Resolve mxc:// URL to HTTP URL via Matrix media API
  const resolvedMediaUrl = useMemo(() => {
    return mxcToDownloadUrl(mediaUrl ?? '', resolvedHomeserver);
  }, [mediaUrl, resolvedHomeserver]);

  const html = useMemo(() => {
    if (formattedContent) {
      const formatted = renderFormattedContent(formattedContent, content).html;
      const mentionResolved = resolveMentionsInHtml(
        formatted,
        memberMap,
        (name) => `<span class="matrix-mention text-emerald-600 font-medium">${name}</span>`
      );
      // Runtimes that wrap GFM tables in <pre><code> blocks render as literal
      // pipes; convert them to real tables before the HTML path renders.
      return convertFencedTablesInHtml(mentionResolved);
    }
    return undefined;
  }, [formattedContent, content, memberMap]);

  const resolvedContent = useMemo(
    () => linkifyMxcUris(
      unwrapFencedTables(resolveMentionsToDisplayNames(content, memberMap)),
      resolvedHomeserver,
    ),
    [content, memberMap, resolvedHomeserver]
  );

  // Full-screen image preview (element-web lightbox)
  const [viewerOpen, setViewerOpen] = useState(false);

  // Render media messages (m.image, m.video, m.audio, m.file)
  if (msgType === 'm.image' && resolvedMediaUrl) {
    return (
      <div className="matrix-message-content">
        <button
          type="button"
          className="block max-w-full rounded-lg cursor-zoom-in focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
          onClick={() => setViewerOpen(true)}
          title="点击查看大图"
        >
          <img
            src={resolvedMediaUrl}
            alt={content}
            className="max-w-full max-h-64 rounded-lg object-contain"
            loading="lazy"
          />
        </button>
        <div className="flex items-center gap-2 mt-1">
          {content && <p className="text-xs text-muted-foreground truncate">{content}</p>}
          <a
            href={mxcToDownloadUrl(mediaUrl ?? '', resolvedHomeserver, { download: true })}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline shrink-0"
          >
            <Download className="w-3 h-3" />
            下载
          </a>
        </div>
        {viewerOpen && (
          <MediaViewer
            src={resolvedMediaUrl}
            filename={content || '图片'}
            onClose={() => setViewerOpen(false)}
          />
        )}
      </div>
    );
  }

  if (msgType === 'm.video' && resolvedMediaUrl) {
    return (
      <div className="matrix-message-content">
        <video
          src={resolvedMediaUrl}
          controls
          preload="metadata"
          className="max-w-full max-h-72 rounded-lg"
        />
        <div className="flex items-center gap-2 mt-1">
          <Play className="w-3 h-3 text-muted-foreground shrink-0" />
          {content && <p className="text-xs text-muted-foreground truncate">{content}</p>}
          <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(mediaInfo?.size)}</span>
        </div>
      </div>
    );
  }

  if (msgType === 'm.audio' && resolvedMediaUrl) {
    return (
      <div className="matrix-message-content">
        <audio src={resolvedMediaUrl} controls preload="metadata" className="max-w-full h-8" />
        <div className="flex items-center gap-2 mt-1">
          <Volume2 className="w-3 h-3 text-muted-foreground shrink-0" />
          {content && <p className="text-xs text-muted-foreground truncate">{content}</p>}
        </div>
      </div>
    );
  }

  if (msgType === 'm.file' && resolvedMediaUrl) {
    return (
      <div className="matrix-message-content">
        <a
          href={mxcToDownloadUrl(mediaUrl ?? '', resolvedHomeserver, { download: true })}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-emerald-600 hover:underline"
          title="下载文件"
        >
          <FileText className="w-4 h-4 shrink-0" />
          <span className="truncate">{content}</span>
          {mediaInfo?.size && (
            <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(mediaInfo.size)}</span>
          )}
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
            <TypingEffect text={content} speed={10} />
          </div>
        );
      }

      // Ensure HTML tables carry the shared table styling (runtimes may send
      // bare <table> markup without any classes). The lookahead keeps <thead>
      // from being mangled into <th ... ead>.
      const enhancedHtml = html
        .replace(
          /<table(?=[\s>])/g,
          '<table class="text-xs border-collapse border border-border"'
        )
        .replace(
          /<th(?=[\s>])/g,
          '<th class="border border-border px-2 py-1 bg-muted"'
        )
        .replace(
          /<td(?=[\s>])/g,
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
          <TypingEffect text={plainContent} speed={10} />
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
