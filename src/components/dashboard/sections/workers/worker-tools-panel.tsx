'use client';

// B6 worker 内置工具面板（#1255 消费；上游已合并 main，issue #1254）：
//   · 声明式单字段 PATCH——Switch 切换即发 {enabled}/{asyncExecution}，
//     幂等可重试（上游先读后写，无变化 = 200 空操作零上游写入）
//   · requiresConfig 只做徽章提示——工具配置值可能含凭据，
//     上游代理边界已剔除，本层永不展示配置内容（fail-closed 定案不放松）
//   · 404（旧 Controller 未含 #1255 / L2 跨团队 W8 防探测隐藏，不可区分）
//     → 占位横幅；400（非 qwenpaw 运行时）/ 502 / 503 → 错误横幅 + 重试
//   · PATCH 403（团队 Leader 只读 / L2 越权写）→ 整面板转只读
//     （authorizer 是权威，前端锁定只是 UX）

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

interface ToolEntry {
  name: string;
  enabled: boolean;
  description?: string;
  asyncExecution?: boolean;
  icon?: string;
  requiresConfig?: boolean;
}

type LoadState = 'loading' | 'ready' | 'unavailable' | 'error';
type ToolField = 'enabled' | 'asyncExecution';

export function WorkerToolsPanel({ workerName }: { workerName: string }) {
  const [state, setState] = useState<LoadState>('loading');
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [loadError, setLoadError] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [patchMsg, setPatchMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const listUrl = `/api/agentteams/workers/${encodeURIComponent(workerName)}/tools`;

  const load = useCallback(async () => {
    // 初值即 'loading'；重试期间沿用旧错误横幅直到响应回来（同 B5 惯例）
    try {
      const res = await fetch(listUrl, { cache: 'no-store' });
      if (res.status === 404) {
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
      const data = (await res.json()) as { tools?: ToolEntry[] };
      setTools(Array.isArray(data.tools) ? data.tools : []);
      setState('ready');
    } catch (err) {
      setState('error');
      setLoadError(err instanceof Error ? err.message : '网络错误');
    }
  }, [listUrl]);

  // load 的 catch 分支含 setState——延迟一个宏任务调用，
  // 保证 effect 同步阶段不进入 load 的 setState 链（react-hooks/set-state-in-effect，同 B5 惯例）
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const patch = useCallback(
    async (tool: string, field: ToolField, value: boolean) => {
      if (busy || readOnly) return;
      const key = `${tool}.${field}`;
      setBusy(key);
      setPatchMsg(null);
      // 乐观更新 + 失败回滚
      setTools((prev) => prev.map((t) => (t.name === tool ? { ...t, [field]: value } : t)));
      try {
        const res = await fetch(`${listUrl}/${encodeURIComponent(tool)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ [field]: value }),
        });
        if (res.status === 403) {
          setTools((prev) =>
            prev.map((t) => (t.name === tool ? { ...t, [field]: !value } : t)),
          );
          setReadOnly(true);
          setPatchMsg({ kind: 'err', text: '当前角色仅可查看，不能修改工具设置' });
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
          setTools((prev) =>
            prev.map((t) => (t.name === tool ? { ...t, [field]: !value } : t)),
          );
          setPatchMsg({ kind: 'err', text: `修改失败：${detail}` });
          return;
        }
        // 200（含空操作）：回传更新条目时防御性同步，非 JSON 也不视为失败
        try {
          const data = (await res.json()) as Partial<ToolEntry> | null;
          if (data && typeof data === 'object' && 'name' in data) {
            const entry = data as ToolEntry;
            setTools((prev) =>
              prev.map((t) => (t.name === entry.name ? { ...t, ...entry } : t)),
            );
          }
        } catch {
          // non-JSON response
        }
        setPatchMsg({
          kind: 'ok',
          text:
            field === 'enabled'
              ? `${tool} 已${value ? '启用' : '停用'}`
              : `${tool} 已设为${value ? '异步执行' : '同步执行'}`,
        });
      } catch (err) {
        setTools((prev) =>
          prev.map((t) => (t.name === tool ? { ...t, [field]: !value } : t)),
        );
        setPatchMsg({ kind: 'err', text: err instanceof Error ? err.message : '修改失败' });
      } finally {
        setBusy(null);
      }
    },
    [busy, listUrl, readOnly],
  );

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        内置工具加载中…
      </div>
    );
  }

  if (state === 'unavailable') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          当前无法加载工具设置（Controller 版本不支持或当前账号无该 Worker 访问权），升级后自动生效。
        </span>
      </div>
    );
  }

  if (state === 'error') {
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
        <p className="text-muted-foreground">内置工具（声明式保存，切换即生效）</p>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void load()}>
          <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
          刷新
        </Button>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>当前角色仅可查看工具设置，不能修改。</span>
        </div>
      )}

      <div className="space-y-1">
        {tools.map((t) => (
          <div
            key={t.name}
            className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5"
          >
            <span className="w-5 text-center text-sm" aria-hidden="true">
              {t.icon || '🔧'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-mono text-xs">{t.name}</span>
                {t.requiresConfig && (
                  <Badge variant="secondary" className="h-4 px-1 text-xs">
                    需配置
                  </Badge>
                )}
              </div>
              {t.description && (
                <p className="truncate text-xs text-muted-foreground" title={t.description}>
                  {t.description}
                </p>
              )}
            </div>
            {busy === `${t.name}.enabled` && (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
            )}
            <div className="flex shrink-0 items-center gap-3">
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                启用
                <Switch
                  checked={t.enabled}
                  disabled={readOnly || busy !== null}
                  onCheckedChange={(v) => void patch(t.name, 'enabled', v)}
                  aria-label={`启用 ${t.name}`}
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                异步
                <Switch
                  checked={t.asyncExecution ?? false}
                  disabled={readOnly || busy !== null}
                  onCheckedChange={(v) => void patch(t.name, 'asyncExecution', v)}
                  aria-label={`${t.name} 异步执行`}
                />
              </label>
            </div>
          </div>
        ))}
        {tools.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">该 Worker 未返回工具列表。</p>
        )}
      </div>

      {patchMsg && (
        <span
          className={`flex items-center gap-1 text-xs ${
            patchMsg.kind === 'ok'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
          }`}
        >
          {patchMsg.kind === 'ok' ? (
            <Check className="h-3 w-3" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
          )}
          {patchMsg.text}
        </span>
      )}
    </div>
  );
}
