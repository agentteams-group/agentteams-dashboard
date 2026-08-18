'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronDown, ChevronRight, FileCode2, FileSearch, FolderTree, HelpCircle, Search, Terminal, Wrench } from 'lucide-react';
import { RuntimeBadge } from '@/components/dashboard/phase-badge';
import type { ToolCallPayload } from './index';

export interface ToolCallCardProps {
  payload: ToolCallPayload;
  icon: typeof Wrench;
  title: string;
  accent: string;
  detailLabel?: string;
  detail?: unknown;
  /** Runtime that produced this tool call (drives the corner badge). */
  runtime?: string | null;
  /** Root Matrix event id, shown when the card is expanded (AC-C7). */
  eventId?: string;
  /** Number of m.replace revisions merged into the message. */
  revisionCount?: number;
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

function isErrorStatus(status?: string) {
  return status === 'error' || status === 'failed';
}

function isRunningStatus(status?: string) {
  return status === 'running' || status === 'in_progress';
}

/** First error line of a tool result/note, truncated for the collapsed summary. */
function errorSummaryOf(payload: ToolCallPayload): string | null {
  const raw = typeof payload.result === 'string'
    ? payload.result
    : typeof payload.note === 'string'
      ? payload.note
      : null;
  if (!raw) return null;
  const firstLine = raw.split('\n').map((line) => line.trim()).find(Boolean);
  if (!firstLine) return null;
  return firstLine.length > 120 ? `${firstLine.slice(0, 119)}…` : firstLine;
}

function truncateEventId(eventId: string): string {
  return eventId.length > 18 ? `${eventId.slice(0, 12)}…${eventId.slice(-4)}` : eventId;
}

function ToolCallCard({ payload, icon: Icon, title, accent, detailLabel, detail, runtime, eventId, revisionCount }: ToolCallCardProps) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? (isRunningStatus(payload.status) || payload.isStreaming);
  const args = parseArguments(payload);
  const hasArguments = Object.keys(args).length > 0;
  const hasResult = payload.result !== undefined;
  const hasDetail = detail !== undefined;
  const lowConfidence = payload.confidence === 'low';
  const isError = isErrorStatus(payload.status);
  const isRunning = isRunningStatus(payload.status) || !!payload.isStreaming;
  const errorSummary = isError ? errorSummaryOf(payload) : null;

  return (
    <section className={`my-2 w-full overflow-hidden rounded-xl border border-l-4 ${accent} shadow-sm hover:shadow-md transition-shadow duration-200`}>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto w-full justify-between px-3 py-2 hover:bg-muted/50"
        onClick={() => setUserOpen((previous) => !(previous ?? open))}
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
          <span className="relative shrink-0">
            <Icon className={`h-3.5 w-3.5 ${isRunning ? 'animate-pulse' : ''}`} aria-hidden="true" />
            {isError && (
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />
            )}
          </span>
          <span className="truncate">{title}</span>
          {runtime && <RuntimeBadge runtime={runtime} size="sm" withTooltip />}
          <Badge variant={isError ? 'destructive' : isRunning ? 'default' : 'secondary'}>
            {statusLabel(payload.status)}
          </Badge>
          {lowConfidence && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex" aria-label="识别置信度低">
                  <HelpCircle className="h-3 w-3 text-muted-foreground/70" aria-hidden="true" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">运行时未提供结构化协议，按通用模式识别</p>
              </TooltipContent>
            </Tooltip>
          )}
        </span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </Button>
      {isError && errorSummary && !open && (
        <p
          className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap border-t border-red-500/10 bg-red-500/5 px-3 py-1.5 text-[11px] text-red-600"
          data-testid="tool-error-summary"
        >
          {errorSummary}
        </p>
      )}
      {open && (
        <div className="space-y-2 px-3 pb-3 text-xs">
          {hasDetail && (
            <ToolValue label={detailLabel || '详情'} value={detail} kind="detail" />
          )}
          {hasArguments && <ToolValue label="参数" value={args} kind="in" />}
          {hasResult && <ToolValue label="结果" value={payload.result} kind={isError ? 'out-error' : 'out'} />}
          {typeof payload.note === 'string' && payload.note && (
            <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{payload.note}</p>
          )}
          {eventId && (
            <p className="text-[10px] text-muted-foreground/60 font-mono" data-testid="event-chain-info">
              事件 {truncateEventId(eventId)}
              {revisionCount ? ` · 编辑 ${revisionCount} 次` : ''}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function ToolValue({ label, value, kind }: { label: string; value: unknown; kind?: 'in' | 'out' | 'out-error' | 'detail' }) {
  const badge =
    kind === 'in'
      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
      : kind === 'out-error'
        ? 'bg-red-500/10 text-red-600 border-red-500/20'
        : 'bg-sky-500/10 text-sky-600 border-sky-500/20';
  return (
    <div className="rounded-lg bg-muted/40 border border-border/30">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/20">
        {kind === 'in' || kind === 'out' || kind === 'out-error' ? (
          <Badge variant="outline" className={`h-4 px-1.5 text-[9px] font-semibold leading-none ${badge}`}>
            {kind === 'in' ? 'IN' : 'OUT'}
          </Badge>
        ) : null}
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
      </div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-foreground">{displayValue(value)}</pre>
    </div>
  );
}

function pathFrom(payload: ToolCallPayload) {
  const args = parseArguments(payload);
  return args.filePath || args.path || args.file;
}

export interface ToolRendererProps {
  payload: ToolCallPayload;
  runtime?: string | null;
  eventId?: string;
  revisionCount?: number;
}

export function ReadFileToolCall({ payload, runtime, eventId, revisionCount }: ToolRendererProps) {
  return <ToolCallCard payload={payload} icon={FileSearch} title={`读取文件${pathFrom(payload) ? ` · ${pathFrom(payload)}` : ''}`} accent="border-l-emerald-500" runtime={runtime} eventId={eventId} revisionCount={revisionCount} />;
}

export function WriteFileToolCall({ payload, runtime, eventId, revisionCount }: ToolRendererProps) {
  return <ToolCallCard payload={payload} icon={FileCode2} title={`写入文件${pathFrom(payload) ? ` · ${pathFrom(payload)}` : ''}`} accent="border-l-amber-500" runtime={runtime} eventId={eventId} revisionCount={revisionCount} />;
}

export function ApplyPatchToolCall({ payload, runtime, eventId, revisionCount }: ToolRendererProps) {
  const args = parseArguments(payload);
  return <ToolCallCard payload={payload} icon={FileCode2} title="应用补丁" accent="border-l-violet-500" detailLabel="补丁" detail={args.patch || args.patchText} runtime={runtime} eventId={eventId} revisionCount={revisionCount} />;
}

export function WebSearchToolCall({ payload, runtime, eventId, revisionCount }: ToolRendererProps) {
  const args = parseArguments(payload);
  return <ToolCallCard payload={payload} icon={Search} title={`网页搜索${args.query ? ` · ${args.query}` : ''}`} accent="border-l-sky-500" runtime={runtime} eventId={eventId} revisionCount={revisionCount} />;
}

export function ExecuteCommandToolCall({ payload, runtime, eventId, revisionCount }: ToolRendererProps) {
  const args = parseArguments(payload);
  return <ToolCallCard payload={payload} icon={Terminal} title={`执行命令${args.command ? ` · ${args.command}` : ''}`} accent="border-l-orange-500" runtime={runtime} eventId={eventId} revisionCount={revisionCount} />;
}

export function ListDirectoryToolCall({ payload, runtime, eventId, revisionCount }: ToolRendererProps) {
  const args = parseArguments(payload);
  return <ToolCallCard payload={payload} icon={FolderTree} title={`列出目录${args.path ? ` · ${args.path}` : ''}`} accent="border-l-cyan-500" runtime={runtime} eventId={eventId} revisionCount={revisionCount} />;
}

export function FallbackToolCall({ payload, runtime, eventId, revisionCount }: ToolRendererProps) {
  return <ToolCallCard payload={payload} icon={Wrench} title={payload.tool_name || '工具调用'} accent="border-l-blue-500" runtime={runtime} eventId={eventId} revisionCount={revisionCount} />;
}
