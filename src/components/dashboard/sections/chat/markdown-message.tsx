'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { StreamingCard } from './streaming-card';
import { ThinkingCard } from './thinking-card';
import { renderFormattedContent } from './format';

interface MarkdownMessageProps {
  content: string;
  formattedContent?: string | null;
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
        parts.push({ type: 'card', payload: JSON.parse(match[2]) });
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

export function MarkdownMessage({ content, formattedContent }: MarkdownMessageProps) {
  const source = formattedContent || content;

  const html = useMemo(() => {
    if (formattedContent) {
      return renderFormattedContent(formattedContent, content).html;
    }
    return undefined;
  }, [formattedContent, content]);

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
                className="[&>p]:mb-1 [&>br]:block"
              />
            );
          }
          if (part.type === 'card') {
            return <StreamingCard key={idx} payload={part.payload} />;
          }
          return <ThinkingCard key={idx} content={part.content} />;
        })}
      </div>
    );
  }

  // For plain text / markdown body
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
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
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
