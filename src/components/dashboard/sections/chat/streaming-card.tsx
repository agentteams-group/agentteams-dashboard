'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Wrench, Zap } from 'lucide-react';

interface StreamingCardProps {
  payload: Record<string, unknown>;
}

function ToolCallCard({ payload }: { payload: Record<string, unknown> }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : '未知工具';
  const args = payload.arguments ?? payload.args;
  const result = payload.result;
  const status = typeof payload.status === 'string' ? payload.status : undefined;
  const open = userOpen ?? (status === 'running');
  const isError = status === 'error' || status === 'failed';
  const isRunning = status === 'running' || status === 'in_progress';
  const errorSummary = isError && typeof result === 'string'
    ? result.split('\n').map((line) => line.trim()).find(Boolean)
    : null;

  const formatJson = (data: unknown): string => {
    if (typeof data === 'string') return data;
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  return (
    <div className="my-2 rounded-xl border border-l-4 border-l-blue-500 bg-blue-500/5 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-between px-3 py-2 h-auto hover:bg-blue-500/10"
        onClick={() => setUserOpen((previous) => !(previous ?? (status === 'running')))}
      >
        <span className="flex items-center gap-2 text-xs font-medium text-blue-600 dark:text-blue-400">
          <span className="relative shrink-0">
            <Wrench className={`w-3.5 h-3.5 ${isRunning ? 'animate-pulse' : ''}`} />
            {isError && (
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />
            )}
          </span>
          {toolName}
          {status && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              status === 'success' ? 'bg-green-500/20 text-green-600' :
              isError ? 'bg-red-500/20 text-red-600' :
              'bg-blue-500/20 text-blue-600'
            }`}>
              {status}
            </span>
          )}
        </span>
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </Button>
      {isError && errorSummary && !open && (
        <p className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap border-t border-red-500/10 bg-red-500/5 px-3 py-1.5 text-[11px] text-red-600">
          {errorSummary}
        </p>
      )}
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {args !== undefined && (
            <div>
              <p className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground mb-1">
                <span className="rounded px-1.5 text-[9px] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">IN</span>
                参数
              </p>
              <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/50 rounded p-2 overflow-x-auto">
                {formatJson(args)}
              </pre>
            </div>
          )}
          {result !== undefined && (
            <div>
              <p className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground mb-1">
                <span className={`rounded px-1.5 text-[9px] font-semibold border ${isError ? 'bg-red-500/10 text-red-600 border-red-500/20' : 'bg-sky-500/10 text-sky-600 border-sky-500/20'}`}>OUT</span>
                结果
              </p>
              <pre className={`text-xs whitespace-pre-wrap font-mono bg-muted/50 rounded p-2 overflow-x-auto ${isError ? 'text-red-600' : ''}`}>
                {formatJson(result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function StreamingCard({ payload }: StreamingCardProps) {
  // Detect tool_call type and render specialized card
  if (payload.type === 'tool_call' || payload.tool_name) {
    return <ToolCallCard payload={payload} />;
  }

  const title = typeof payload.title === 'string' ? payload.title : '卡片';
  const content = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload, null, 2);
  const actions = Array.isArray(payload.actions) ? payload.actions as { label: string; url?: string }[] : [];

  return (
    <Card className="my-2 border-l-4 border-l-emerald-500">
      <CardHeader className="py-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-emerald-500" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="py-2">
        <pre className="text-xs whitespace-pre-wrap font-mono">{content}</pre>
        {actions.length > 0 && (
          <div className="flex gap-2 mt-2">
            {actions.map((action, idx) => (
              <a
                key={idx}
                href={action.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-emerald-600 hover:underline"
              >
                {action.label}
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
