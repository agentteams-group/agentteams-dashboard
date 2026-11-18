'use client';

import { useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiUrl, extractErrorDetail } from '@/lib/api-base';
import { CREATABLE_WORKER_RUNTIMES, isLegacyCopaw } from '@/lib/runtime-options';
import { runtimeLabel } from '@/lib/runtime-labels';

interface Handoff {
  id: string;
  phase: string;
  source: { runtime: string };
  target_runtime: string;
}

interface Snapshot {
  etag: string | null;
  active_start?: { runtime: string };
  handoff?: Handoff;
}

const phases: Record<string, string> = {
  preflight: '预检中', draining: '停止领取新工作', checkpointed: '已保存检查点',
  stopping: '正在停止旧实例', stopped: '已确认旧实例停止', creating: '正在创建目标实例',
  recovering: '等待新实例就绪', completed: '运行时已切换',
};

async function readSnapshot(response: Response): Promise<Snapshot> {
  if (!response.ok) {
    if (response.status === 404 || response.status === 405) throw new Error('当前 Controller 未提供此 Worker 的运行时交接。');
    if (response.status === 403) throw new Error('当前账号无权操作此 Worker 的运行时交接。');
    throw new Error(await extractErrorDetail(response, `交接请求失败（HTTP ${response.status}）`));
  }
  const state = await response.json();
  if (state?.kind !== 'WorkerRuntimeState' || state.schema_version !== 1) {
    throw new Error('Controller 未返回支持的运行时交接状态。');
  }
  return { active_start: state.active_start, handoff: state.handoff, etag: response.headers.get('ETag') };
}

export function WorkerRuntimeHandoff({ name, runtime }: { name: string; runtime: string }) {
  const url = apiUrl(`/api/agentteams/workers/${encodeURIComponent(name)}/runtime-handoff`);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [selected, setSelected] = useState('');
  const [readError, setReadError] = useState('');
  const [writeError, setWriteError] = useState('');
  const [posting, setPosting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const request = useRef<{ target: string; id: string } | null>(null);

  useEffect(() => {
    if (posting) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const state = await readSnapshot(await fetch(url, { signal: abort.signal, cache: 'no-store' }));
        if (abort.signal.aborted) return;
        setSnapshot(state);
        setReadError('');
        if (state.handoff?.id === request.current?.id) setWriteError('');
        if (state.handoff && state.handoff.phase !== 'completed') timer = setTimeout(read, 2000);
      } catch (error) {
        if (!abort.signal.aborted) setReadError(error instanceof Error ? error.message : '读取交接状态失败');
      }
    }
    void read();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [url, posting, refresh]);

  const op = snapshot?.handoff;
  const busy = Boolean(op && op.phase !== 'completed');
  const current = snapshot?.active_start?.runtime || (op?.phase === 'completed' ? op.target_runtime : runtime);
  const target = busy && op ? op.target_runtime : selected || (isLegacyCopaw(current) ? 'qwenpaw' : current);
  const disabled = !snapshot || Boolean(readError) || busy || posting;
  const unknown = current && !CREATABLE_WORKER_RUNTIMES.some((r) => r.value === current);

  async function switchRuntime() {
    if (!snapshot || readError || busy || posting || !target || target === current) return;
    if (request.current?.target !== target || request.current.id === op?.id) {
      request.current = { target, id: uuid() };
    }
    setPosting(true);
    setWriteError('');
    try {
      const result = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(snapshot.etag ? { 'If-Match': snapshot.etag } : { 'If-None-Match': '*' }) },
        body: JSON.stringify({ request_id: request.current.id, target_runtime: target }),
      });
      const state = await readSnapshot(result);
      setSnapshot(state);
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : '提交交接失败');
    } finally {
      setPosting(false);
      setRefresh((n) => n + 1);
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={`handoff-${name}`}>运行时</Label>
      <p className="text-xs text-muted-foreground">当前运行时为 {current ? runtimeLabel(current) : '未指定'}</p>
      <Select value={target} disabled={disabled} onValueChange={(value) => { if (!disabled) setSelected(value); }}>
        <SelectTrigger id={`handoff-${name}`} className="w-full"><SelectValue placeholder="选择目标运行时" /></SelectTrigger>
        <SelectContent>
          {unknown && <SelectItem value={current} disabled>{runtimeLabel(current)}（存量）</SelectItem>}
          {CREATABLE_WORKER_RUNTIMES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {op && <p role="status" className="text-xs text-muted-foreground">
        {runtimeLabel(op.source.runtime)} → {runtimeLabel(op.target_runtime)} · {phases[op.phase] || op.phase}
        <span className="block break-all">请求 {op.id}</span>
      </p>}
      {readError && <p role="alert" className="text-xs text-destructive">{readError}</p>}
      {writeError && <p role="alert" className="text-xs text-destructive">{writeError}</p>}
      {readError ? <Button type="button" size="sm" variant="outline" onClick={() => setRefresh((n) => n + 1)}>重新读取交接状态</Button>
        : !busy && snapshot && target && target !== current &&
          <Button type="button" size="sm" variant="outline" disabled={posting} onClick={switchRuntime}>
            {posting ? '提交中…' : `从 ${runtimeLabel(current)} 切换到 ${runtimeLabel(target)}`}
          </Button>}
    </div>
  );
}
