'use client';

import { z } from 'zod';
import {
  Catalog,
} from '@a2ui/web_core/v0_9';
import {
  createComponentImplementation,
  type ReactComponentImplementation,
} from '@a2ui/react/v0_9';
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Loader2,
  Wrench,
  Zap,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

// ─── Helper: Create component API with permissive typing ─────────────────────
// A2UI uses Zod v3 internally, but the project uses Zod v4.
// We use 'as any' to bridge the type gap while maintaining runtime compatibility.

 
type AnyComponentApi = any;

function makeApi(name: string, schema: z.ZodTypeAny): AnyComponentApi {
  return { name, schema };
}

// ─── ThinkingBlock ───────────────────────────────────────────────────────────

const ThinkingBlockApi = makeApi('ThinkingBlock', z.object({
  content: z.string(),
  title: z.optional(z.string()),
  isStreaming: z.optional(z.boolean()),
}));

const ThinkingBlock = createComponentImplementation(
  ThinkingBlockApi,
  ({ props }: { props: Record<string, unknown> }) => {
    const content = typeof props.content === 'string' ? props.content : '';
    const title = typeof props.title === 'string' && props.title ? props.title : '思考过程';
    const isStreaming = props.isStreaming === true;
    const [open, setOpen] = useState(isStreaming);

    useEffect(() => {
      if (isStreaming) setOpen(true);
    }, [isStreaming]);

    return (
      <div className="my-2 rounded-lg border border-amber-500/20 bg-amber-500/5 overflow-hidden">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-amber-500/10 transition-colors"
        >
          {isStreaming ? (
            <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
          ) : (
            <Brain className="w-4 h-4 text-amber-500" />
          )}
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400 flex-1">
            {title}
          </span>
          {isStreaming && (
            <span className="text-[10px] text-amber-500 animate-pulse mr-2">
              思考中...
            </span>
          )}
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </button>
        {open && content && (
          <div className="px-3 pb-3 border-t border-amber-500/10">
            <pre
              className={`mt-2 text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed ${
                isStreaming ? 'animate-pulse' : ''
              }`}
            >
              {content}
            </pre>
          </div>
        )}
      </div>
    );
  }
);

// ─── ToolCallBlock ───────────────────────────────────────────────────────────

const ToolCallBlockApi = makeApi('ToolCallBlock', z.object({
  toolName: z.string(),
  arguments: z.optional(z.union([z.string(), z.record(z.string(), z.any())])),
  result: z.optional(z.union([z.string(), z.record(z.string(), z.any())])),
  status: z.optional(z.enum(['success', 'error', 'running'])),
  isStreaming: z.optional(z.boolean()),
}));

function formatJson(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value, null, 2);
  }
  return String(value ?? '');
}

const ToolCallBlock = createComponentImplementation(
  ToolCallBlockApi,
  ({ props }: { props: Record<string, unknown> }) => {
    const toolName = typeof props.toolName === 'string' ? props.toolName : '工具调用';
    const status = (props.status as string) ?? 'success';
    const isStreaming = props.isStreaming === true;
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const argsStr = formatJson(props.arguments);
    const resultStr = formatJson(props.result);

    const copyResult = () => {
      navigator.clipboard.writeText(resultStr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    const statusBadge: Record<string, React.ReactNode> = {
      success: (
        <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-3 h-3" /> 成功
        </span>
      ),
      error: (
        <span className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400">
          <XCircle className="w-3 h-3" /> 失败
        </span>
      ),
      running: (
        <span className="flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400">
          <Loader2 className="w-3 h-3 animate-spin" /> 执行中
        </span>
      ),
    };

    return (
      <div className="my-2 rounded-lg border border-blue-500/20 bg-blue-500/5 overflow-hidden">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-blue-500/10 transition-colors"
        >
          {isStreaming ? (
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
          ) : (
            <Wrench className="w-4 h-4 text-blue-500" />
          )}
          <span className="text-xs font-medium text-blue-600 dark:text-blue-400 flex-1 truncate">
            {toolName}
          </span>
          {statusBadge[status] || statusBadge.success}
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground ml-1" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground ml-1" />
          )}
        </button>
        {open && (
          <div className="px-3 pb-3 border-t border-blue-500/10 space-y-2">
            {argsStr && (
              <div>
                <p className="text-[10px] font-medium text-muted-foreground mt-2 mb-1 flex items-center gap-1">
                  <Zap className="w-3 h-3" /> 参数
                </p>
                <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                  {argsStr}
                </pre>
              </div>
            )}
            {resultStr && (
              <div>
                <div className="flex items-center justify-between mt-2 mb-1">
                  <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> 结果
                  </p>
                  <button
                    onClick={copyResult}
                    className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
                <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                  {resultStr}
                </pre>
              </div>
            )}
            {isStreaming && !resultStr && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                等待结果...
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);

// ─── StreamingText ───────────────────────────────────────────────────────────

const StreamingTextApi = makeApi('StreamingText', z.object({
  text: z.string(),
  isStreaming: z.optional(z.boolean()),
}));

const StreamingText = createComponentImplementation(
  StreamingTextApi,
  ({ props }: { props: Record<string, unknown> }) => {
    const text = typeof props.text === 'string' ? props.text : '';
    const isStreaming = props.isStreaming === true;

    return (
      <div className={`prose prose-sm dark:prose-invert max-w-none ${isStreaming ? 'animate-pulse' : ''}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {text}
        </ReactMarkdown>
        {isStreaming && (
          <span className="inline-block w-2 h-4 bg-foreground/60 animate-pulse ml-0.5" />
        )}
      </div>
    );
  }
);

// ─── MarkdownBlock ───────────────────────────────────────────────────────────

const MarkdownBlockApi = makeApi('MarkdownBlock', z.object({
  content: z.string(),
}));

const MarkdownBlock = createComponentImplementation(
  MarkdownBlockApi,
  ({ props }: { props: Record<string, unknown> }) => {
    const content = typeof props.content === 'string' ? props.content : '';

    return (
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {content}
        </ReactMarkdown>
      </div>
    );
  }
);

// ─── CollapsibleBlock ────────────────────────────────────────────────────────

const CollapsibleBlockApi = makeApi('CollapsibleBlock', z.object({
  title: z.string(),
  defaultOpen: z.optional(z.boolean()),
}));

const CollapsibleBlock = createComponentImplementation(
  CollapsibleBlockApi,
  ({ props, buildChild }: { props: Record<string, unknown>; buildChild: (_id: string) => React.ReactNode }) => {
    const title = typeof props.title === 'string' ? props.title : '';
    const [open, setOpen] = useState((props.defaultOpen as boolean) ?? false);

    return (
      <div className="my-2 rounded-lg border border-border/50 overflow-hidden">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent/50 transition-colors"
        >
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-medium">{title}</span>
        </button>
        {open && (
          <div className="px-3 pb-3 border-t border-border/30">
            {buildChild('content')}
          </div>
        )}
      </div>
    );
  }
);

// ─── StatusBadge ─────────────────────────────────────────────────────────────

const StatusBadgeApi = makeApi('StatusBadge', z.object({
  status: z.enum(['success', 'error', 'running', 'warning', 'info']),
  label: z.string(),
}));

const StatusBadge = createComponentImplementation(
  StatusBadgeApi,
  ({ props }: { props: Record<string, unknown> }) => {
    const label = typeof props.label === 'string' ? props.label : '';
    const status = (props.status as string) || 'info';
    const colors: Record<string, string> = {
      success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
      error: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
      running: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
      warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
      info: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
    };

    return (
      <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${colors[status] || colors.info}`}>
        {label}
      </span>
    );
  }
);

// ─── Create the catalog ──────────────────────────────────────────────────────

export const agentteamsChatCatalog = new Catalog<ReactComponentImplementation>(
  'agentteams-chat',
  [
    ThinkingBlock,
    ToolCallBlock,
    StreamingText,
    MarkdownBlock,
    CollapsibleBlock,
    StatusBadge,
  ]
);
