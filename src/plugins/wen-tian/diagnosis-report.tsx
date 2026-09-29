'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ────────────────────────────────────────────
// Report rendering
// ────────────────────────────────────────────

function ReportCodeBlock({ language, children }: { language?: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="relative group my-2 rounded-lg overflow-hidden border bg-muted/50">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted text-xs text-muted-foreground">
        <span>{language || 'code'}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-60 group-hover:opacity-100 transition-opacity"
          onClick={handleCopy}
          title="复制代码"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </Button>
      </div>
      <pre className="p-3 overflow-x-auto m-0 text-xs">
        <code>{children}</code>
      </pre>
    </div>
  );
}

/** Rich markdown renderer tuned for the AI diagnosis report. */
export function DiagnosisReport({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div className="text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1({ children }) {
            return <h3 className="text-lg font-bold mt-3 mb-2 pb-1.5 border-b">{children}</h3>;
          },
          h2({ children }) {
            return <h4 className="text-base font-semibold mt-4 mb-2 pb-1.5 border-b flex items-center gap-1.5">{children}</h4>;
          },
          h3({ children }) {
            return <h5 className="text-sm font-semibold mt-3 mb-1.5">{children}</h5>;
          },
          p({ children }) {
            return <p className="leading-relaxed mb-2 last:mb-0">{children}</p>;
          },
          ul({ children }) {
            return <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>;
          },
          li({ children }) {
            return <li className="leading-relaxed">{children}</li>;
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                {children}
              </a>
            );
          },
          blockquote({ children }) {
            return <blockquote className="border-l-4 border-primary/40 pl-3 my-2 text-muted-foreground italic">{children}</blockquote>;
          },
          hr() {
            return <hr className="my-3 border-border" />;
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-2 rounded-md border">
                <table className="w-full text-xs border-collapse">{children}</table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-muted/60">{children}</thead>;
          },
          th({ children }) {
            return <th className="border-b px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">{children}</th>;
          },
          td({ children }) {
            return <td className="border-b border-border/60 px-2.5 py-1.5 align-top">{children}</td>;
          },
          code({ className, children, ...props }) {
            const code = String(children).replace(/\n$/, '');
            if (className?.includes('language-')) {
              return <ReportCodeBlock language={className.replace('language-', '')}>{code}</ReportCodeBlock>;
            }
            return <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono" {...props} />;
          },
          pre({ children }) {
            return <div className="my-1">{children}</div>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {streaming && (
        <span className="inline-block w-2 h-4 ml-0.5 align-text-bottom rounded-sm bg-primary animate-pulse" />
      )}
    </div>
  );
}
