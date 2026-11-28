'use client';

import { useMemo, useState, useEffect, useRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
import type { Root, RootContent } from 'mdast';
import { escapeHtml } from '@/lib/utils';
import { chatMarkdownSchema } from './sanitize-schema';
import { Copy, Check, Download, Play, Volume2 } from 'lucide-react';
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
import { AttachmentCard } from './attachment-card';
import { parseObservabilityLink } from '@/lib/observability-links';
import { markdownUrl } from '@/lib/markdown-url';

interface MarkdownMessageProps {
  content: string;
  formattedContent?: string | null;
  msgType?: string;
  mediaUrl?: string;
  mediaInfo?: { mimetype?: string; size?: number; w?: number; h?: number };
  homeserver?: string;
  memberMap?: Record<string, string>;
  mentionedUserIds?: string[];
  /** Streaming placeholder path: lightweight text render + trailing cursor. */
  isStreaming?: boolean;
}

function CodeBlock({ language, children }: { language?: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText((codeRef.current?.textContent ?? '').replace(/\n$/, ''));
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
          className="h-6 w-6 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
          onClick={handleCopy}
          aria-label={copied ? '已复制' : '复制代码'}
        >
          {copied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
        </Button>
      </div>
      <pre className="p-3 overflow-x-auto m-0">
        <code ref={codeRef} className={`text-xs ${language ? `language-${language}` : ''}`}>{children}</code>
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

/** Typing effect: reveals text character by character during streaming. */
function TypingEffect({ text, speed }: { text: string; speed?: number }) {
  const [count, setCount] = useState(0);
  const [seenText, setSeenText] = useState(text);

  // Reset the typing head when the message text is replaced; streaming appends
  // extend the same text (the new text starts with what we already saw), so
  // they must keep the head where it is. Adjusting state during render is the
  // documented pattern for deriving state from a changing prop.
  if (seenText !== text && !text.startsWith(seenText)) {
    setSeenText(text);
    setCount(0);
  }

  useEffect(() => {
    if (count >= text.length) return;
    const timer = setTimeout(() => setCount((c) => c + 1), speed ?? 12);
    return () => clearTimeout(timer);
  }, [count, text.length, speed]);

  return (
    <span>
      {text.slice(0, count)}
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

/**
 * 引用块（回复时带进来的原消息）在气泡内的唯一一套版式（方案 v3 B-4）。
 *
 * 原来两处各写一份 `border-l-4 border-emerald-500/50 pl-4 italic`（一份在流式
 * 渲染的 [&_blockquote] 变体里，一份在 react-markdown 的 components 里），
 * 颜色写死绿色不跟随主题，缩进也比消息里其它次级信息宽一档。引用是「别人的
 * 话」而不是正文，统一成细左边线 + 12px 缩进 + 次要色。
 */
const QUOTE_CLASS = 'my-2 border-l-2 border-border pl-3 italic text-muted-foreground';
const EVIDENCE_CLASS = 'my-3 min-w-0 rounded-xl border border-border bg-card p-4 text-foreground not-italic shadow-none [&_pre]:max-h-56 [&_pre]:whitespace-pre-wrap [&_pre]:break-words';
const MENTION_CLASS = 'matrix-mention rounded bg-blue-500/10 px-1 font-medium text-blue-600 dark:text-blue-400';

function remarkMentions(memberMap?: Record<string, string>, prefixHtml?: string) {
  return () => (tree: Root) => {
    function walk(parent: { children: RootContent[] }) {
      parent.children = parent.children.flatMap<RootContent>(node => {
        if (node.type === 'link' || node.type === 'linkReference') return [node];
        if (node.type !== 'text') {
          if ('children' in node) walk(node as { children: RootContent[] });
          return [node];
        }
        return node.value.split(/((?<![\p{L}\p{N}._])@[\p{L}\p{N}._:/-]+)/u).filter(Boolean).map(part => {
          const name = resolveMentionsToDisplayNames(part, memberMap);
          return part.startsWith('@') && name !== part
            ? { type: 'html' as const, value: `<span class="${MENTION_CLASS}">@${escapeHtml(name)}</span>` }
            : { type: 'text' as const, value: part };
        });
      });
    }
    walk(tree);
    if (prefixHtml) {
      const firstParagraph = tree.children.find(node => node.type === 'paragraph');
      const prefix = { type: 'html' as const, value: prefixHtml };
      if (firstParagraph) firstParagraph.children.unshift(prefix);
      else tree.children.unshift({ type: 'paragraph', children: [prefix] });
    }
  };
}

function hasEvidenceLink(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const element = node as { properties?: { href?: string }; children?: unknown[] };
  return Boolean(parseObservabilityLink(element.properties?.href)) || Boolean(element.children?.some(hasEvidenceLink));
}

export function MarkdownMessage({ content, formattedContent, msgType, mediaUrl, mediaInfo, homeserver, memberMap, mentionedUserIds, isStreaming }: MarkdownMessageProps) {
  // Prop takes precedence; fall back to the logged-in homeserver from the
  // store so media URLs resolve even when the caller omits the prop.
  const { homeserver: storeHomeserver } = useMatrixStore();
  const resolvedHomeserver = homeserver || storeHomeserver;
  // Resolve mxc:// URL to HTTP URL via Matrix media API
  const resolvedMediaUrl = useMemo(() => {
    return mxcToDownloadUrl(mediaUrl ?? '', resolvedHomeserver);
  }, [mediaUrl, resolvedHomeserver]);

  const mentionPrefix = useMemo(() => {
    const tokens = new Set(content.match(/@[\p{L}\p{N}._:/-]+/gu) ?? []);
    return [...new Set(mentionedUserIds)].filter(id => {
      const name = memberMap?.[id] ?? id.slice(1).split(':')[0];
      return ![id, `@${id.slice(1).split(':')[0]}`, `@${name}`].some(token => tokens.has(token))
        && !formattedContent?.includes(encodeURIComponent(id)) && !formattedContent?.includes(id);
    }).map(id => `<span class="${MENTION_CLASS}">@${escapeHtml(memberMap?.[id] ?? id.slice(1).split(':')[0])}</span> `).join('');
  }, [content, formattedContent, memberMap, mentionedUserIds]);

  const html = useMemo(() => {
    if (formattedContent) {
      const formatted = renderFormattedContent(formattedContent, content).html;
      let mentionResolved = resolveMentionsInHtml(
        formatted,
        memberMap,
        (name) => `<span class="${MENTION_CLASS}">@${name}</span>`
      ).replace(/<a\b[^>]*href=["']https:\/\/matrix\.to\/#\/(?:@|%40)[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi,
        (_link, label: string) => `<span class="${MENTION_CLASS}">@${label.replace(/<[^>]*>/g, '').replace(/^@/, '')}</span>`);
      if (mentionPrefix) {
        mentionResolved = /<p(?:\s[^>]*)?>/i.test(mentionResolved)
          ? mentionResolved.replace(/<p(?:\s[^>]*)?>/i, paragraph => paragraph + mentionPrefix)
          : mentionPrefix + mentionResolved;
      }
      // Runtimes that wrap GFM tables in <pre><code> blocks render as literal
      // pipes; convert them to real tables before the HTML path renders.
      return convertFencedTablesInHtml(mentionResolved);
    }
    return undefined;
  }, [formattedContent, content, memberMap, mentionPrefix]);

  const resolvedContent = useMemo(
    () => linkifyMxcUris(
      unwrapFencedTables(content),
      resolvedHomeserver,
    ),
    [content, resolvedHomeserver]
  );

  // Full-screen image preview (element-web lightbox)
  const [viewerOpen, setViewerOpen] = useState(false);

  // Render media messages (m.image, m.video, m.audio, m.file)
  if (msgType === 'm.image' && resolvedMediaUrl) {
    return (
      <div className="matrix-message-content">
        <button
          type="button"
          className="block max-w-full rounded-lg cursor-zoom-in focus:outline-none focus:ring-1 focus:ring-ring"
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
            className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2 shrink-0"
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

  if (msgType === 'm.file' && mediaUrl && resolvedMediaUrl) {
    return <AttachmentCard homeserver={resolvedHomeserver} payload={{
      url: mediaUrl, filename: content, mimetype: mediaInfo?.mimetype ?? '', size: mediaInfo?.size,
    }} />;
  }

  // For HTML formatted_body, render directly (card/thinking already split off
  // at the normalization layer, so a text block is plain HTML content).
  // Exception: some runtimes (e.g. openclaw) ship a formatted_body whose GFM
  // tables were never converted to <table> markup — the pipes are plain text
  // inside <p>/<br>. Rendering that as raw HTML shows literal pipes, so detect
  // the case (no real table element while the text has a Markdown table) and
  // fall through to the Markdown renderer below, where remark-gfm builds the
  // table.
  // Matrix formatted_body and plain Markdown use the same evidence renderer.
  // Other formatted messages retain their existing lightweight HTML path.
  const evidenceHtml = html && /#console\/governance\/(?:monitoring|tracing)(?:[?"'<>\s]|$)/.test(html) ? html : null;
  if (html && !evidenceHtml) {
    const hasRealHtmlTable = /<table[\s>]/i.test(html);
    const mdTableOnly = !hasRealHtmlTable && hasMarkdownTable(htmlToPlainText(html));

    if (!mdTableOnly) {
      const mermaidChart = html.match(/```mermaid\n([\s\S]*?)\n```/);
      const hasMermaid = !!mermaidChart;

      if (isStreaming && !mentionPrefix && !hasBlockFeatures(html) && !hasMermaid) {
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
        )
        .replace(
          /(<table[\s\S]*?<\/table>)/gi,
          '<div class="my-2 max-w-full overflow-x-auto">$1</div>'
        );

      return (
        <div className="matrix-message-content text-sm space-y-1">
          {hasMermaid && <MermaidRenderer content={html} />}
          <div
            dangerouslySetInnerHTML={{ __html: enhancedHtml }}
            className="[&>p]:mb-1 [&>br]:block
              [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2
              [&_img]:max-w-full [&_img]:max-h-64 [&_img]:rounded-lg
              [&_pre]:bg-muted/50 [&_pre]:rounded-lg [&_pre]:p-3
              [&_code]:bg-muted/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded
              [&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-2 [&_h1]:mb-1
              [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1
              [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-1.5 [&_h3]:mb-0.5
              [&_h4]:text-sm [&_h4]:font-medium [&_h4]:mt-1 [&_h4]:mb-0.5
              [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground"
          />
        </div>
      );
    }
    // mdTableOnly → the Markdown renderer below owns this message.
  }

  const markdownContent = evidenceHtml || resolvedContent;
  const mermaidChart = markdownContent.match(/```mermaid\n([\s\S]*?)\n```/);
  const hasMermaid = !!mermaidChart;
  const plainContent = hasMermaid ? markdownContent.replace(/```mermaid\n[\s\S]*?\n```/g, '').trim() : markdownContent;

  // Streaming lightweight path: no block-level features → plain pre + cursor.
  if (isStreaming && !mentionPrefix && !evidenceHtml && !hasBlockFeatures(plainContent) && !hasMermaid) {
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
        urlTransform={markdownUrl}
        remarkPlugins={[remarkGfm, remarkMath, remarkMentions(memberMap, evidenceHtml ? undefined : mentionPrefix)]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, chatMarkdownSchema],
          rehypeHighlight,
          rehypeKatex,
        ]}
        components={{
          code({ className, children, ...props }) {
            const language = /\blanguage-([^\s]+)/.exec(className ?? '')?.[1];
            if (className?.includes('language-')) {
              return <CodeBlock language={language}>{children}</CodeBlock>;
            }
            return (
              <code className="bg-muted px-1 py-0.5 rounded text-xs" {...props}>{children}</code>
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
            const evidenceLink = parseObservabilityLink(href);
            return (
              <a
                href={href}
                target={evidenceLink ? undefined : '_blank'}
                rel={evidenceLink ? undefined : 'noopener noreferrer'}
                className={evidenceLink ? 'mr-2 mt-1 inline-flex min-h-8 items-center rounded-md border bg-background px-3 py-1 text-xs font-medium text-foreground no-underline hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring' : 'text-primary underline underline-offset-2'}
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
          blockquote({ children, node }) {
            const evidence = hasEvidenceLink(node);
            return (
              <blockquote data-observability-evidence={evidence || undefined} className={evidence ? EVIDENCE_CLASS : QUOTE_CLASS}>
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
