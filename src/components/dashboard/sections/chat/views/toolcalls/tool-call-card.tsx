'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, FileCode2, FileSearch, FolderTree, Search, Terminal, Wrench } from 'lucide-react';
import type { ToolCallPayload } from './index';

interface ToolCallCardProps {
  payload: ToolCallPayload;
  icon: typeof Wrench;
  title: string;
  accent: string;
  detailLabel?: string;
  detail?: unknown;
}

function parseArguments(payload: ToolCallPayload): Record<string, unknown> {
  const value = payload.arguments ?? payload.args;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : { value };
  } catch {
    return { value };
  }
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function statusLabel(status?: string) {
  if (status === 'success' || status === 'completed') return '已完成';
  if (status === 'error' || status === 'failed') return '失败';
  if (status === 'running' || status === 'in_progress') return '进行中';
  return status || '等待中';
}

function ToolCallCard({ payload, icon: Icon, title, accent, detailLabel, detail }: ToolCallCardProps) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? (payload.status === 'running' || payload.status === 'in_progress' || payload.isStreaming);
  const args = parseArguments(payload);
  const hasArguments = Object.keys(args).length > 0;
  const hasResult = payload.result !== undefined;
  const hasDetail = detail !== undefined;

  return (
    <section className={`my-2 w-full overflow-hidden rounded-xl border border-border/60 bg-card/80 shadow-sm`}>
      <div className={`h-0.5 w-full ${accent.replace('border-l-', 'bg-')}`} />
      <Button
        variant="ghost"
        size="sm"
        className="h-auto w-full justify-between px-3 py-2 hover:bg-accent/50 transition-colors"
        onClick={() => setUserOpen((previous) => !(previous ?? open))}
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{title}</span>
          <Badge variant="secondary" className="text-[10px]">{statusLabel(payload.status)}</Badge>
        </span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </Button>
      {open && (
        <div className="space-y-2 px-3 pb-3 text-xs">
          {hasDetail && (
            <ToolValue label={detailLabel || '详情'} value={detail} />
          )}
          {hasArguments && <ToolValue label="参数" value={args} />}
          {hasResult && <ToolValue label="结果" value={payload.result} />}
        </div>
      )}
    </section>
  );
}

function ToolValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 border border-border/40 p-2 font-mono text-xs">{displayValue(value)}</pre>
    </div>
  );
}

function pathFrom(payload: ToolCallPayload) {
  const args = parseArguments(payload);
  return args.filePath || args.path || args.file;
}

export function ReadFileToolCall({ payload }: { payload: ToolCallPayload }) {
  return <ToolCallCard payload={payload} icon={FileSearch} title={`读取文件${pathFrom(payload) ? ` · ${pathFrom(payload)}` : ''}`} accent="border-l-emerald-500" />;
}

export function WriteFileToolCall({ payload }: { payload: ToolCallPayload }) {
  return <ToolCallCard payload={payload} icon={FileCode2} title={`写入文件${pathFrom(payload) ? ` · ${pathFrom(payload)}` : ''}`} accent="border-l-amber-500" />;
}

export function ApplyPatchToolCall({ payload }: { payload: ToolCallPayload }) {
  const args = parseArguments(payload);
  return <ToolCallCard payload={payload} icon={FileCode2} title="应用补丁" accent="border-l-violet-500" detailLabel="补丁" detail={args.patch || args.patchText} />;
}

export function WebSearchToolCall({ payload }: { payload: ToolCallPayload }) {
  const args = parseArguments(payload);
  return <ToolCallCard payload={payload} icon={Search} title={`网页搜索${args.query ? ` · ${args.query}` : ''}`} accent="border-l-sky-500" />;
}

export function ExecuteCommandToolCall({ payload }: { payload: ToolCallPayload }) {
  const args = parseArguments(payload);
  return <ToolCallCard payload={payload} icon={Terminal} title={`执行命令${args.command ? ` · ${args.command}` : ''}`} accent="border-l-orange-500" />;
}

export function ListDirectoryToolCall({ payload }: { payload: ToolCallPayload }) {
  const args = parseArguments(payload);
  return <ToolCallCard payload={payload} icon={FolderTree} title={`列出目录${args.path ? ` · ${args.path}` : ''}`} accent="border-l-cyan-500" />;
}

export function FallbackToolCall({ payload }: { payload: ToolCallPayload }) {
  return <ToolCallCard payload={payload} icon={Wrench} title={payload.tool_name || '工具调用'} accent="border-l-blue-500" />;
}
