'use client';

// LLM 调优面板（#146 缺口 3）。
// 读回显：GET /api/v1/workers/{name}；保存：PUT /api/v1/workers/{name}（字段级 diff）。
// 归属层级：Worker 覆盖 → 团队默认 → QwenPaw registry 默认（见 src/lib/llm-tuning.ts）。

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { agentteamsApi } from '@/lib/agentteams-api';
import {
  diffLlmTuning,
  findLlmTuningError,
  pickLlmTuning,
  type LlmTuningKey,
  type LlmTuningRecord,
} from '@/lib/llm-tuning';
import { LlmTuningFields } from './llm-tuning-fields';

type LoadState = 'loading' | 'ready' | 'error';

export function WorkerLlmTuningPanel({ workerName }: { workerName: string }) {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [current, setCurrent] = useState<LlmTuningRecord | null>(null);
  const [draft, setDraft] = useState<LlmTuningRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const worker = await agentteamsApi.getWorker(workerName);
      const picked = pickLlmTuning(worker);
      setCurrent(picked);
      setDraft(picked);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '加载失败');
      setState('error');
    }
  }, [workerName]);

  // 宿主以 key={worker.name} 重挂载本组件（编辑态随卸载清零）。延迟一个宏任务
  // 调用 load，避免 effect 同步阶段进入 load 的 setState 链
  // （react-hooks/set-state-in-effect）。
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const onField = useCallback((key: LlmTuningKey, value: string) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaveMsg(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!current || !draft || saving) return;
    if (findLlmTuningError(draft)) return;
    const diff = diffLlmTuning(current, draft);
    if (Object.keys(diff).length === 0) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await agentteamsApi.updateWorker(workerName, diff);
      // 本地落值（= 服务端合并结果）：不依赖 PUT 回显形状。
      setCurrent((prev) => (prev ? { ...prev, ...diff } : prev));
      setDraft((prev) => (prev ? { ...prev, ...diff } : prev));
      setSaveMsg({ kind: 'ok', text: '已保存（启动期参数需重建容器生效）' });
    } catch (err) {
      setSaveMsg({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' });
    } finally {
      setSaving(false);
    }
  }, [current, draft, saving, workerName]);

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        LLM 调优参数加载中…
      </div>
    );
  }

  if (state === 'error' || !current || !draft) {
    return (
      <div className="space-y-1 pt-2">
        <p className="text-muted-foreground">LLM 调优参数</p>
        <p className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
          {loadError || '该 Worker 未读到 LLM 调优参数（Controller 升级后自动开放）'}
        </p>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void load()}>
          <RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" />
          重试
        </Button>
      </div>
    );
  }

  const error = findLlmTuningError(draft);
  const hasChanges = Object.keys(diffLlmTuning(current, draft)).length > 0;

  return (
    <div className="space-y-2 pt-2">
      <p
        className="text-muted-foreground"
        title="归属层级：Worker 覆盖 → 团队默认 → QwenPaw registry 默认。留空 = 不设置（逐级继承）。"
      >
        LLM 调优参数（Worker 覆盖团队默认）
      </p>

      <LlmTuningFields
        values={draft}
        onChange={onField}
        disabled={saving}
        idPrefix={`llm-${workerName}`}
      />

      <p className="text-[10px] text-muted-foreground">
        留空表示不设置：先继承团队默认，再回退 QwenPaw 默认。「重试与限流」改动需重建容器生效；「流式超时」即时生效。
      </p>

      {error && (
        <p className="flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400">
          <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
          {error.label}：{error.message}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={!hasChanges || !!error || saving}
          onClick={() => void handleSave()}
        >
          {saving ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="mr-1 h-3 w-3" aria-hidden="true" />
          )}
          保存改动
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => {
            setDraft(current);
            setSaveMsg(null);
          }}
        >
          撤销
        </Button>
        {saveMsg && (
          <span
            className={`flex items-center gap-1 text-[11px] ${
              saveMsg.kind === 'ok'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {saveMsg.kind === 'ok' ? (
              <Check className="h-3 w-3" aria-hidden="true" />
            ) : (
              <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
            )}
            {saveMsg.text}
          </span>
        )}
      </div>
    </div>
  );
}
