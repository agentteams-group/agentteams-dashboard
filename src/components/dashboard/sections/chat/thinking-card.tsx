'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Brain, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ThinkingCardProps {
  title?: string;
  content: string;
  isStreaming?: boolean;
}

export function ThinkingCard({ title = '思考过程', content, isStreaming }: ThinkingCardProps) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? Boolean(isStreaming);

  return (
    <div className="my-2 rounded-xl border border-border/40 bg-card overflow-hidden">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-between px-3 py-2 h-auto hover:bg-emerald-500/10 transition-colors"
        onClick={() => setUserOpen((previous) => !(previous ?? Boolean(isStreaming)))}
      >
        <span className="flex items-center gap-2 text-xs font-medium text-emerald-400">
          {isStreaming ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Brain className="w-3.5 h-3.5" />
          )}
          {title}
          {isStreaming && (
            <span className="text-[10px] text-emerald-400 animate-pulse">思考中...</span>
          )}
        </span>
        {open ? (
          <ChevronDown className="w-4 h-4 text-emerald-400/70" />
        ) : (
          <ChevronRight className="w-4 h-4 text-emerald-400/70" />
        )}
      </Button>
      {open && (
        <div className="px-3 pb-3">
          <pre className={`text-xs whitespace-pre-wrap font-mono text-emerald-300/80 ${isStreaming ? 'animate-pulse' : ''}`}>
            {content || (isStreaming ? '正在思考...' : '')}
          </pre>
        </div>
      )}
    </div>
  );
}
