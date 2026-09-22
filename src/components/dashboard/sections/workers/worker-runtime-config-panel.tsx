'use client';

// B5 worker runtime-config 面板（#1231 消费，spec=PR/worker-runtime-config/scope.md）
// 与插件 A2 表单同构语义：
//   · 字段级 diff——PUT body 只发改动字段，未动字段（含 loop_config）不发
//   · loop 字段（max_iters / loop_config）改动 → 提示「将通知团队 Leader」
//   · loop_config = 整块 JSON 替换入口（只读展示 + 整体替换，同插件 A2）
//   · 404（#1231 未合并）→ 占位横幅；409（path lock）→「稍后重试」

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface RuntimeConfig {
  max_iters?: number;
  max_input_tokens?: number;
  compaction_threshold?: number;
  loop_config?: unknown;
}

type LoadState = 'loading' | 'ready' | 'unavailable' | 'error';

function isPositiveInt(v: string): boolean {
  const n = Number(v);
  return Number.isInteger(n) && n > 0;
}

function isThreshold(v: string): boolean {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 1;
}

export function WorkerRuntimeConfigPanel({ workerName }: { workerName: string }) {
  const [state, setState] = useState<LoadState>('loading');
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [loadError, setLoadError] = useState('');
  // 编辑值（字符串=输入中；null=未编辑）
  const [maxIters, setMaxIters] = useState<string | null>(null);
  const [maxInputTokens, setMaxInputTokens] = useState<string | null>(null);
  const [compaction, setCompaction] = useState<string | null>(null);
  const [loopText, setLoopText] = useState<string | null>(null);
  const [loopOpen, setLoopOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const url = `/api/agentteams/workers/${encodeURIComponent(workerName)}/runtime-config`;

  const load = useCallback(async () => {
    // 注意：不在 effect 触发的首段做同步 setState（react-hooks/set-state-in-effect）；
    // 初值即 'loading'，重试期间沿用旧错误横幅直到响应回来。
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.status === 404) {
        // #1231 未合并：占位降级，不报错
        setState('unavailable');
        return;
      }
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string; message?: string };
          if (typeof body?.message === 'string' && body.message) detail = body.message;
          else if (typeof body?.error === 'string' && body.error) detail = body.error;
        } catch {
          // non-JSON body
        }
        setState('error');
        setLoadError(detail);
        return;
      }
      const json = (await res.json()) as RuntimeConfig;
      setConfig(json);
      setState('ready');
    } catch (err) {
      setState('error');
      setLoadError(err instanceof Error ? err.message : '加载失败');
    }
  }, [url]);

  // 换 worker 时宿主以 key={worker.name} 重挂载本组件（编辑态随卸载清零），
  // 这里只负责加载。load 的 catch 分支含 setState——延迟一个宏任务调用，
  // 保证 effect 同步阶段不进入 load 的 setState 链（react-hooks/set-state-in-effect）。
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // config 重新加载后清空编辑态——避免「刷新后输入框仍显示旧 typed 值」造成
  // 与 server 新值的视觉错位（用户报"刷新叠加输入框"的根因：用户输入 '200'、
  // 手动点刷新，server 已回 '100'，但 maxIters 仍是 '200'，输入框显示 200 ≠ config 100）
  useEffect(() => {
    setMaxIters(null);
    setMaxInputTokens(null);
    setCompaction(null);
    setLoopText(null);
  }, [config]);

  // ── 字段级 diff（spec 核心语义：未动字段不发）────────────────────
  const buildDiff = (): { diff: Record<string, unknown>; invalid: string } => {
    const diff: Record<string, unknown> = {};
    if (!config) return { diff, invalid: '' };
    const intPairs: Array<{ key: 'max_iters' | 'max_input_tokens'; edited: string | null; invalidMsg: string }> = [
      { key: 'max_iters', edited: maxIters, invalidMsg: 'max_iters 须为正整数' },
      { key: 'max_input_tokens', edited: maxInputTokens, invalidMsg: 'max_input_tokens 须为正整数' },
    ];
    for (const { key, edited, invalidMsg } of intPairs) {
      if (edited === null) continue;
      const trimmed = edited.trim();
      if (!isPositiveInt(trimmed)) return { diff, invalid: invalidMsg };
      if (Number(trimmed) !== config[key]) diff[key] = Number(trimmed);
    }
    if (compaction !== null) {
      const trimmed = compaction.trim();
      if (!isThreshold(trimmed)) return { diff, invalid: 'compaction_threshold 须为 0-1 之间的小数' };
      if (Number(trimmed) !== config.compaction_threshold) diff.compaction_threshold = Number(trimmed);
    }
    if (loopText !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(loopText);
      } catch {
        return { diff, invalid: 'loop_config 不是合法 JSON' };
      }
      const original = JSON.stringify(config.loop_config ?? null);
      if (JSON.stringify(parsed) !== original) diff.loop_config = parsed;
    }
    return { diff, invalid: '' };
  };

  const { diff, invalid } = buildDiff();
  const hasChanges = Object.keys(diff).length > 0;
  const involvesLoop = 'max_iters' in diff || 'loop_config' in diff;

  const handleSave = useCallback(async () => {
    if (!hasChanges || saving) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(diff),
      });
      if (res.status === 409) {
        setSaveMsg({ kind: 'err', text: '配置被锁定（409），稍后重试' });
        return;
      }
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string; message?: string };
          if (typeof body?.message === 'string' && body.message) detail = body.message;
          else if (typeof body?.error === 'string' && body.error) detail = body.error;
        } catch {
          // non-JSON body
        }
        setSaveMsg({ kind: 'err', text: `保存失败：${detail}` });
        return;
      }
      // 本地落值（= 服务端合并后的结果）
      setConfig((prev) => (prev ? { ...prev, ...diff } : prev));
      setMaxIters(null);
      setMaxInputTokens(null);
      setCompaction(null);
      setLoopText(null);
      setSaveMsg({
        kind: 'ok',
        text: involvesLoop ? '已保存。loop 字段改动将通知团队 Leader' : '已保存',
      });
    } catch (err) {
      setSaveMsg({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' });
    } finally {
      setSaving(false);
    }
  }, [diff, hasChanges, involvesLoop, saving, url]);

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Runtime 配置加载中…
      </div>
    );
  }

  if (state === 'unavailable') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>当前 Controller 版本未提供 Runtime 配置端点，升级 AgentTeams 后自动生效。</span>
      </div>
    );
  }

  if (state === 'error' || !config) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1">加载失败：{loadError}</span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void load()}>
          <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground">Runtime 配置（字段级保存）</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[11px] text-muted-foreground">max_iters（最大迭代）</span>
          <Input
            type="number"
            className="h-8 text-xs font-mono"
            value={maxIters ?? String(config.max_iters ?? '')}
            onChange={(e) => setMaxIters(e.target.value)}
            min={1}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-muted-foreground">max_input_tokens</span>
          <Input
            type="number"
            className="h-8 text-xs font-mono"
            value={maxInputTokens ?? String(config.max_input_tokens ?? '')}
            onChange={(e) => setMaxInputTokens(e.target.value)}
            min={1}
          />
        </label>
        <label className="col-span-2 space-y-1">
          <span className="text-[11px] text-muted-foreground">compaction_threshold（0-1）</span>
          <Input
            type="number"
            className="h-8 text-xs font-mono"
            value={compaction ?? String(config.compaction_threshold ?? '')}
            onChange={(e) => setCompaction(e.target.value)}
            min={0}
            max={1}
            step={0.05}
          />
        </label>
      </div>

      {/* loop_config：整块 JSON 替换入口（同插件 A2「loop 字段整块」） */}
      <div className="rounded-md border border-border/60">
        <button
          type="button"
          className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/50"
          onClick={() => setLoopOpen((v) => !v)}
        >
          {loopOpen ? (
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          )}
          loop_config（整块替换）
        </button>
        {loopOpen && (
          <div className="border-t border-border/60 p-2">
            <textarea
              className="w-full rounded-md border bg-muted/20 p-2 font-mono text-[11px] min-h-[80px]"
              value={
                loopText ?? JSON.stringify(config.loop_config ?? {}, null, 2)
              }
              onChange={(e) => setLoopText(e.target.value)}
              spellCheck={false}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              loop 字段（max_iters / loop_config）改动将通知团队 Leader
            </p>
          </div>
        )}
      </div>

      {invalid && (
        <p className="flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400">
          <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
          {invalid}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7 text-xs" disabled={!hasChanges || !!invalid || saving} onClick={() => void handleSave()}>
          {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" /> : <Check className="mr-1 h-3 w-3" aria-hidden="true" />}
          保存改动
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void load()}>
          刷新
        </Button>
        {saveMsg && (
          <span
            className={`flex items-center gap-1 text-[11px] ${
              saveMsg.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
            }`}
          >
            {saveMsg.kind === 'ok' ? <Check className="h-3 w-3" aria-hidden="true" /> : <AlertCircle className="h-3 w-3" aria-hidden="true" />}
            {saveMsg.text}
          </span>
        )}
      </div>
    </div>
  );
}
