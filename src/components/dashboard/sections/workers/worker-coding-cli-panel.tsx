'use client';

// B7 worker Coding CLI 面板（#1360 消费）：
//   · 探测 / settings 脱敏 / 哨兵 *** / 异步安装轮询 / 六场景 preset
//   · 404 → 占位横幅（中性文案，不裸露上游变更编号）
//   · 502 容器不可达 / 503 非 embedded → 错误横幅
//   · 403 写拒绝 → 整面板只读

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  CODING_CLI_IDS,
  CODING_CLI_PRESETS,
  isRedacted,
  localizedText,
  type CodingCliId,
  type CodingCliPreset,
  type CodingCliProbeItem,
  type InstallTask,
  type SettingsObject,
  type SettingsValue,
} from '@/lib/coding-cli-presets';

type LoadState = 'loading' | 'ready' | 'unavailable' | 'error';

const CLI_LABEL: Record<CodingCliId, string> = {
  'qwen-code': 'Qwen Code',
  opencode: 'OpenCode',
  qoder: 'Qoder',
};

const SENTINEL = '***';
const POLL_MS = 1500;
const POLL_MAX_MS = 5 * 60 * 1000;

function httpDetail(status: number, body: { error?: string; message?: string } | null): string {
  if (status === 503) return '当前部署模式不支持容器内安装与配置（embedded 才可执行）';
  if (status === 502) return '无法在该 Worker 容器内执行管理命令';
  if (typeof body?.message === 'string' && body.message) return body.message;
  if (typeof body?.error === 'string' && body.error) return body.error;
  return `HTTP ${status}`;
}

async function readError(res: Response): Promise<string> {
  let body: { error?: string; message?: string } | null = null;
  try {
    body = (await res.json()) as { error?: string; message?: string };
  } catch {
    // non-JSON
  }
  return httpDetail(res.status, body);
}

function ingestProbeItem(item: unknown, into: Map<string, CodingCliProbeItem>) {
  if (!item || typeof item !== 'object') return;
  const o = item as Record<string, unknown>;
  const auth = o.auth as { configured?: boolean } | undefined;
  const id = typeof o.id === 'string' ? o.id : typeof o.name === 'string' ? o.name : '';
  if (!id) return;
  into.set(id, {
    id: id as CodingCliId,
    installed: o.installed === true,
    version: typeof o.version === 'string' ? o.version : undefined,
    auth_configured:
      auth?.configured === true || o.auth_configured === true || o.authConfigured === true,
  });
}

function normalizeProbe(body: unknown): CodingCliProbeItem[] {
  const byId = new Map<string, CodingCliProbeItem>();
  if (Array.isArray(body)) {
    body.forEach((item) => ingestProbeItem(item, byId));
  } else if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    if (Array.isArray(o.clis)) o.clis.forEach((item) => ingestProbeItem(item, byId));
    else if (Array.isArray(o.items)) o.items.forEach((item) => ingestProbeItem(item, byId));
    else {
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === 'object') ingestProbeItem({ id: k, ...(v as object) }, byId);
      }
    }
  }
  // 白名单重映射：未知 CLI id 静默丢弃，面板只展示 qwen-code / opencode / qoder。
  return CODING_CLI_IDS.map((id) => {
    const found = byId.get(id);
    return {
      id,
      installed: found?.installed === true,
      version: found?.version,
      auth_configured: found?.auth_configured === true,
    };
  });
}

function getModelName(settings: SettingsObject): string {
  const model = settings.model;
  if (typeof model === 'string') return model;
  if (model && typeof model === 'object' && !Array.isArray(model) && !isRedacted(model)) {
    const name = (model as SettingsObject).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

function collectRedacted(
  obj: SettingsObject,
  path: string[] = [],
): Array<{ path: string[]; has_value: boolean }> {
  // 只递归普通对象；数组内脱敏键走 JSON 补丁区。
  const out: Array<{ path: string[]; has_value: boolean }> = [];
  for (const [key, value] of Object.entries(obj)) {
    const next = [...path, key];
    if (isRedacted(value)) out.push({ path: next, has_value: value.has_value });
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out.push(...collectRedacted(value as SettingsObject, next));
    }
  }
  return out;
}

function assignPath(target: SettingsObject, path: string[], value: SettingsValue) {
  let cursor = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const child = cursor[key];
    if (!child || typeof child !== 'object' || Array.isArray(child) || isRedacted(child)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as SettingsObject;
  }
  cursor[path[path.length - 1]] = value;
}

function mergePatch(target: SettingsObject, patch: SettingsObject) {
  for (const [key, value] of Object.entries(patch)) {
    const current = target[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !isRedacted(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      !isRedacted(current)
    ) {
      mergePatch(current as SettingsObject, value as SettingsObject);
    } else {
      target[key] = value;
    }
  }
}

function hasRedactedPlaceholder(value: SettingsValue): boolean {
  if (isRedacted(value)) return true;
  if (Array.isArray(value)) return value.some((item) => hasRedactedPlaceholder(item));
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => hasRedactedPlaceholder(item));
  }
  return false;
}

function previewJson(settings: SettingsObject): string {
  return JSON.stringify(
    settings,
    (_key, value) => {
      if (isRedacted(value)) return value.has_value ? '***' : null;
      return value;
    },
    2,
  );
}

export function WorkerCodingCliPanel({ workerName }: { workerName: string }) {
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<CodingCliProbeItem[]>([]);
  const [loadError, setLoadError] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [selected, setSelected] = useState<CodingCliId>('qwen-code');
  const [settings, setSettings] = useState<SettingsObject | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelName, setModelName] = useState('');
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [versionTag, setVersionTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [appliedPreset, setAppliedPreset] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<CodingCliPreset | null>(null);
  const [jsonPatch, setJsonPatch] = useState('');
  const [uninstallTarget, setUninstallTarget] = useState<CodingCliId | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const settingsReqRef = useRef(0);

  const base = `/api/agentteams/workers/${encodeURIComponent(workerName)}/coding-cli`;

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      stopPoll();
    };
  }, [stopPoll]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: 'no-store' });
      if (cancelledRef.current) return;
      if (res.status === 404) {
        setState('unavailable');
        return;
      }
      if (!res.ok) {
        setLoadError(await readError(res));
        setState('error');
        return;
      }
      const json = (await res.json()) as unknown;
      setItems(normalizeProbe(json));
      setState('ready');
    } catch (err) {
      if (cancelledRef.current) return;
      setState('error');
      setLoadError(err instanceof Error ? err.message : '网络错误');
    }
  }, [base]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const loadSettings = useCallback(
    async (cli: CodingCliId) => {
      const reqId = ++settingsReqRef.current;
      setSelected(cli);
      setSettingsOpen(true);
      setSettings(null);
      setModelName('');
      setSecrets({});
      setJsonPatch('');
      try {
        const res = await fetch(`${base}/${encodeURIComponent(cli)}/settings`, { cache: 'no-store' });
        if (cancelledRef.current || reqId !== settingsReqRef.current) return;
        if (res.status === 404) {
          setState('unavailable');
          return;
        }
        if (res.status === 403) {
          setReadOnly(true);
          setSettingsOpen(false);
          setMsg({ kind: 'err', text: '当前角色仅可查看，不能修改编码 CLI' });
          return;
        }
        if (!res.ok) {
          const text = await readError(res);
          if (cancelledRef.current || reqId !== settingsReqRef.current) return;
          setSettingsOpen(false);
          setMsg({ kind: 'err', text });
          return;
        }
        const json = (await res.json()) as SettingsObject;
        if (cancelledRef.current || reqId !== settingsReqRef.current) return;
        const value = json && typeof json === 'object' ? json.settings ?? json : {};
        const config =
          value && typeof value === 'object' && !Array.isArray(value)
            ? (value as SettingsObject)
            : {};
        setSettings(config);
        setModelName(getModelName(config));
        setSecrets({});
      } catch (err) {
        if (cancelledRef.current || reqId !== settingsReqRef.current) return;
        setSettingsOpen(false);
        setMsg({ kind: 'err', text: err instanceof Error ? err.message : '加载 settings 失败' });
      }
    },
    [base],
  );

  const saveSettings = useCallback(async () => {
    if (!settings || busy || readOnly) return;
    const diff: SettingsObject = {};
    if (modelName !== getModelName(settings)) {
      assignPath(diff, ['model', 'name'], modelName);
    }
    for (const field of collectRedacted(settings)) {
      const key = field.path.join('.');
      const typed = (secrets[key] ?? '').trim();
      if (typed) assignPath(diff, field.path, typed);
      else if (field.has_value) assignPath(diff, field.path, SENTINEL);
    }
    const patchText = jsonPatch.trim();
    if (patchText) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(patchText) as unknown;
      } catch {
        setMsg({ kind: 'err', text: '补丁不是合法 JSON' });
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setMsg({ kind: 'err', text: '补丁须为 JSON 对象' });
        return;
      }
      if (hasRedactedPlaceholder(parsed as SettingsObject)) {
        setMsg({ kind: 'err', text: '补丁不能包含脱敏占位，请填写真实密钥或留空由密钥栏保留' });
        return;
      }
      mergePatch(diff, parsed as SettingsObject);
    }
    if (Object.keys(diff).length === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${base}/${encodeURIComponent(selected)}/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(diff),
      });
      if (res.status === 403) {
        setReadOnly(true);
        setMsg({ kind: 'err', text: '当前角色仅可查看，不能修改编码 CLI' });
        return;
      }
      if (!res.ok) {
        setMsg({ kind: 'err', text: await readError(res) });
        return;
      }
      setMsg({ kind: 'ok', text: '已保存' });
      await loadSettings(selected);
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' });
    } finally {
      setBusy(false);
    }
  }, [base, busy, jsonPatch, loadSettings, modelName, readOnly, secrets, selected, settings]);

  const pollTask = useCallback(
    async (cli: CodingCliId, taskId: string) => {
      const tick = async (): Promise<'stop' | 'continue'> => {
        if (cancelledRef.current) return 'stop';
        try {
          const res = await fetch(
            `${base}/${encodeURIComponent(cli)}/install/${encodeURIComponent(taskId)}`,
            { cache: 'no-store' },
          );
          if (cancelledRef.current) return 'stop';
          if (!res.ok) {
            setMsg({ kind: 'err', text: await readError(res) });
            return 'stop';
          }
          const task = (await res.json()) as InstallTask;
          if (cancelledRef.current) return 'stop';
          const state = task.state ?? task.status;
          if (state === 'done') {
            setMsg({ kind: 'ok', text: `${CLI_LABEL[cli]} 任务完成` });
            await load();
            return 'stop';
          }
          if (state === 'failed') {
            const stderr = task.stderr_tail ?? task.stderr;
            const extra =
              typeof stderr === 'string' && stderr
                ? stderr
                : typeof task.exit_code === 'number'
                  ? `退出码 ${task.exit_code}`
                  : '安装失败';
            setMsg({ kind: 'err', text: extra });
            return 'stop';
          }
          return 'continue';
        } catch (err) {
          if (cancelledRef.current) return 'stop';
          setMsg({ kind: 'err', text: err instanceof Error ? err.message : '查询任务失败' });
          return 'stop';
        }
      };
      if ((await tick()) === 'stop') {
        setBusy(false);
        return;
      }
      const started = Date.now();
      stopPoll();
      const schedule = () => {
        pollRef.current = setTimeout(() => {
          void (async () => {
            if (cancelledRef.current) {
              setBusy(false);
              return;
            }
            if (Date.now() - started > POLL_MAX_MS) {
              stopPoll();
              setBusy(false);
              setMsg({ kind: 'err', text: '安装仍在进行，请稍后刷新' });
              return;
            }
            const result = await tick();
            if (result === 'stop') {
              setBusy(false);
              return;
            }
            schedule();
          })();
        }, POLL_MS);
      };
      schedule();
    },
    [base, load, stopPoll],
  );

  const runInstall = useCallback(
    async (cli: CodingCliId, action: 'install' | 'uninstall') => {
      if (busy || readOnly) return;
      setSelected(cli);
      setBusy(true);
      setMsg(null);
      try {
        const body: { action: 'install' | 'uninstall'; version?: string } = { action };
        const tag = versionTag.trim();
        if (action === 'install' && tag) body.version = tag;
        const res = await fetch(`${base}/${encodeURIComponent(cli)}/install`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.status === 403) {
          setReadOnly(true);
          setBusy(false);
          setMsg({ kind: 'err', text: '当前角色仅可查看，不能修改编码 CLI' });
          return;
        }
        if (res.status === 409) {
          setBusy(false);
          setMsg({ kind: 'err', text: '该 CLI 已有安装任务进行中' });
          return;
        }
        if (res.status !== 202) {
          setBusy(false);
          setMsg({ kind: 'err', text: await readError(res) });
          return;
        }
        const accepted = (await res.json()) as { task_id?: string };
        if (!accepted.task_id) {
          setBusy(false);
          setMsg({ kind: 'err', text: '安装请求未返回任务 ID' });
          return;
        }
        await pollTask(cli, accepted.task_id);
      } catch (err) {
        setBusy(false);
        setMsg({ kind: 'err', text: err instanceof Error ? err.message : '安装请求失败' });
      }
    },
    [base, busy, pollTask, readOnly, versionTag],
  );

  const applyPreset = useCallback(
    async (preset: CodingCliPreset) => {
      if (busy || readOnly) return;
      const patch = preset.settings_patch ?? {};
      if (Object.keys(patch).length === 0) {
        setAppliedPreset(preset.id);
        setSuggestion(preset);
        setMsg({ kind: 'ok', text: `已套用 ${localizedText(preset.name)}` });
        return;
      }
      setBusy(true);
      setMsg(null);
      try {
        const res = await fetch(`${base}/${encodeURIComponent(selected)}/settings`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (res.status === 403) {
          setReadOnly(true);
          setMsg({ kind: 'err', text: '当前角色仅可查看，不能修改编码 CLI' });
          return;
        }
        if (!res.ok) {
          setMsg({ kind: 'err', text: await readError(res) });
          return;
        }
        setAppliedPreset(preset.id);
        setSuggestion(preset);
        setMsg({ kind: 'ok', text: `已套用 ${localizedText(preset.name)}` });
        if (settingsOpen) await loadSettings(selected);
      } catch (err) {
        setMsg({ kind: 'err', text: err instanceof Error ? err.message : '套用模板失败' });
      } finally {
        setBusy(false);
      }
    },
    [base, busy, loadSettings, readOnly, selected, settingsOpen],
  );

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        编码 CLI 加载中…
      </div>
    );
  }

  if (state === 'unavailable') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>该 Worker 的编码 CLI 管理暂不可用，升级 AgentTeams 后自动生效。</span>
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

  const redacted = settings ? collectRedacted(settings) : [];
  const selectedInstalled = items.some((cli) => cli.id === selected && cli.installed);

  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground">编码 CLI（探测 / 安装 / 配置）</p>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void load()}>
          <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
          刷新
        </Button>
      </div>

      {readOnly && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">当前角色仅可查看，不能修改编码 CLI。</p>
      )}

      <div className="space-y-1.5">
        {items.map((cli) => (
          <div
            key={cli.id}
            className={`rounded-md border px-2 py-1.5 ${
              selected === cli.id ? 'border-primary/60' : 'border-border/60'
            }`}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                className="font-mono text-xs"
                aria-label={`选择 ${CLI_LABEL[cli.id]}`}
                aria-pressed={selected === cli.id}
                onClick={() => {
                  settingsReqRef.current += 1;
                  setSelected(cli.id);
                  setSettingsOpen(false);
                  setSettings(null);
                  setJsonPatch('');
                }}
              >
                {CLI_LABEL[cli.id]}
              </button>
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                {cli.installed ? cli.version || '已安装' : '未安装'}
              </Badge>
              {cli.auth_configured && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                  鉴权已配置
                </Badge>
              )}
              {cli.auth_configured && !cli.installed && (
                <span className="text-[11px] text-amber-700 dark:text-amber-300">
                  容器重建后需重新安装；已保存的鉴权可保留
                </span>
              )}
              <span className="ml-auto flex items-center gap-1">
                {cli.installed ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      disabled={busy || readOnly}
                      aria-label={`编辑 ${CLI_LABEL[cli.id]} 配置`}
                      onClick={() => void loadSettings(cli.id)}
                    >
                      编辑配置
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      disabled={busy || readOnly}
                      aria-label={`卸载 ${CLI_LABEL[cli.id]}`}
                      onClick={() => setUninstallTarget(cli.id)}
                    >
                      卸载
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    disabled={busy || readOnly}
                    aria-label={`安装 ${CLI_LABEL[cli.id]}`}
                    onClick={() => void runInstall(cli.id, 'install')}
                  >
                    安装
                  </Button>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">安装版本（可选）</span>
        <Input
          value={versionTag}
          onChange={(e) => setVersionTag(e.target.value)}
          className="h-7 max-w-[10rem] text-xs"
          placeholder="默认 latest"
          disabled={readOnly}
        />
      </div>

      {settingsOpen && !settings && (
        <p className="text-[11px] text-muted-foreground">加载 settings…</p>
      )}

      {settingsOpen && settings && (
        <div className="space-y-1.5 rounded-md border border-border/60 p-2">
          <p className="text-[11px] text-muted-foreground">{CLI_LABEL[selected]} settings</p>
          <label className="block text-[11px] text-muted-foreground">
            模型名
            <Input
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="mt-0.5 h-7 text-xs"
              disabled={readOnly}
            />
          </label>
          {redacted.map((field) => {
            const key = field.path.join('.');
            return (
              <label key={key} className="block text-[11px] text-muted-foreground">
                {key}
                {field.has_value ? '（已保存，留空保留）' : ''}
                <Input
                  type="password"
                  value={secrets[key] ?? ''}
                  onChange={(e) => setSecrets((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="mt-0.5 h-7 text-xs"
                  placeholder={field.has_value ? '已保存' : ''}
                  disabled={readOnly}
                />
              </label>
            );
          })}
          <p className="text-[11px] text-muted-foreground">当前配置（只读）</p>
          <pre
            className="max-h-40 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px]"
            aria-label="当前配置只读预览"
          >
            {previewJson(settings)}
          </pre>
          <label className="block text-[11px] text-muted-foreground">
            可选 JSON 补丁（同键以补丁为准）
            <Textarea
              value={jsonPatch}
              onChange={(e) => setJsonPatch(e.target.value)}
              className="mt-0.5 min-h-16 font-mono text-xs"
              placeholder='{"mcp":{"enabled":true}}'
              disabled={readOnly}
            />
          </label>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={busy || readOnly}
            onClick={() => void saveSettings()}
          >
            保存配置
          </Button>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground">
          场景模板（只写模型名，工具链/MCP 需确认）· 当前 CLI：{CLI_LABEL[selected]}
        </p>
        {!selectedInstalled && (
          <p className="text-[11px] text-muted-foreground">先安装当前 CLI，再套用场景模板</p>
        )}
        <div className="flex flex-wrap gap-1">
          {CODING_CLI_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              variant={appliedPreset === preset.id ? 'default' : 'outline'}
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={busy || readOnly || !selectedInstalled}
              onClick={() => void applyPreset(preset)}
            >
              {localizedText(preset.name)}
            </Button>
          ))}
        </div>
      </div>

      {suggestion && (
        <div className="space-y-1 rounded-md border border-border/60 p-2 text-[11px]">
          <p className="text-muted-foreground">建议清单（需人工确认，未写入 Worker CR）</p>
          {suggestion.toolchain.shared_volume && (
            <p>共享卷：{suggestion.toolchain.shared_volume}</p>
          )}
          {suggestion.toolchain.install && (
            <p>工具链：{localizedText(suggestion.toolchain.install)}</p>
          )}
          {suggestion.toolchain.env && Object.keys(suggestion.toolchain.env).length > 0 && (
            <p>环境变量：{Object.keys(suggestion.toolchain.env).join(', ')}</p>
          )}
          {suggestion.toolchain.note && (
            <p>工具链说明：{localizedText(suggestion.toolchain.note)}</p>
          )}
          {suggestion.mcp.suggested.length > 0 && (
            <p>MCP：{suggestion.mcp.suggested.join('；')}</p>
          )}
          {suggestion.artifacts?.note && <p>产物：{suggestion.artifacts.note}</p>}
          {suggestion.arch_note && (
            <p>架构注意：{localizedText(suggestion.arch_note)}</p>
          )}
        </div>
      )}

      {msg && (
        <span
          className={`flex items-center gap-1 text-[11px] ${
            msg.kind === 'ok'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
          }`}
        >
          {msg.kind === 'ok' ? (
            <Check className="h-3 w-3" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
          )}
          {msg.text}
        </span>
      )}

      <AlertDialog
        open={uninstallTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setUninstallTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认卸载</AlertDialogTitle>
            <AlertDialogDescription>
              {`将从该 Worker 容器卸载 ${uninstallTarget ? CLI_LABEL[uninstallTarget] : ''}。安装状态会丢失，已保存的鉴权可保留。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (!uninstallTarget) return;
                const cli = uninstallTarget;
                setUninstallTarget(null);
                void runInstall(cli, 'uninstall');
              }}
            >
              确认卸载
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
