'use client';

import { useEffect, useRef, useState, memo } from 'react';
import { Loader2 } from 'lucide-react';

interface MermaidBlockProps {
  chart: string;
}

const MermaidBlock = memo(function MermaidBlock({ chart }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const initAndRender = async () => {
      setLoading(true);
      setError(null);
      setSvg(null);
      try {
        const mod = await import('mermaid');
        if (cancelled) return;
        const mermaid = mod.default || mod;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          flowchart: { useMaxWidth: true, htmlLabels: true },
          sequence: { useMaxWidth: true },
          gantt: { useMaxWidth: true },
        });

        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const { svg: renderedSvg } = await mermaid.render(id, chart);
        if (!cancelled) {
          setSvg(renderedSvg);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '渲染失败');
          setLoading(false);
        }
      }
    };

    initAndRender();
    return () => { cancelled = true; };
  }, [chart]);

  return (
    <div className="my-2 rounded-lg border border-border bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted text-xs text-muted-foreground border-b border-border">
        <span className="flex items-center gap-1.5 font-medium">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500 shrink-0">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
          流程图
        </span>
      </div>
      <div ref={containerRef} className="p-3 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">渲染中...</span>
          </div>
        ) : error ? (
          <div className="text-xs text-red-500 py-2 font-mono break-all">{error}</div>
        ) : svg ? (
          <div
            className="mermaid-svg min-w-max"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : null}
      </div>
    </div>
  );
});

export function MermaidRenderer({ content }: { content: string }) {
  const match = content.match(/```mermaid\n([\s\S]*?)\n```/);
  if (!match) return null;
  return <MermaidBlock chart={match[1].trim()} />;
}
