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
    <div className="my-2 rounded-lg border bg-muted/30 overflow-hidden">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-between px-3 py-2 h-auto"
        onClick={() => setUserOpen((previous) => !(previous ?? Boolean(isStreaming)))}
      >
        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          {isStreaming ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
          ) : (
            <Brain className="w-3.5 h-3.5" />
          )}
          {title}
          {isStreaming && (
            <span className="text-[10px] text-emerald-500 animate-pulse">思考中...</span>
          )}
        </span>
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </Button>
      {open && (
        <div className="px-3 pb-3">
          <pre className={`text-xs whitespace-pre-wrap font-mono text-muted-foreground ${isStreaming ? 'animate-pulse' : ''}`}>
            {content || (isStreaming ? '正在思考...' : '')}
          </pre>
        </div>
      )}
    </div>
  );
}
