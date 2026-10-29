'use client';

// B4 worker 频道矩阵（#1219 68800348 + #1269 e75da919 合并版消费，10 端点；
// 路由层见 api/agentteams/workers/[name]/channels/[...rest]/route.ts）。
// 契约形状正源（合并版实读）：
//   - AgentTeams docs/design/worker-channels-api.md（10 路由/授权表/PUT 语义/版本门）
//   - QwenPaw server：config.py 路由形状 + pydantic 模型 + conflict.py
//   - QwenPaw console 渲染层（Control/Channels：builtin 频道表单为硬编码 per-channel，
//     /schemas 仅插件频道；保存前 conflict-check 预检 enabled 门控）
//   GET /channels → Record<channel, config+isBuiltin>（凭据不脱敏；isBuiltin=API 元数据，PUT 前必须剥）
//   GET /types → string[]；GET /schemas → 仅插件注册频道（builtin 无 config_fields → 走模板）
//   PUT /{channel} → body=完整频道配置 → 200 + 头 X-AgentTeams-MinIO-Persisted（true/false/skipped）
//   GET /{channel}/health → {channel, status: healthy|unhealthy|disabled, detail}
//   GET /{channel}/qrcode → {qrcode_img: base64PNG, poll_token}；status?token= → {status, credentials}
//     （扫码按钮仅 QRCODE_AUTH_HANDLERS 五频道 wechat/wecom/dingtalk/feishu/qq 显示）
//   POST /{channel}/restart → {channel, status: restarted, detail}
//   POST /{channel}/conflict-check → {conflict, agents:[{agent_id,agent_name}]}（2.2.x 独有；
//     2.0.x worker 自答 404=版本门，原样透传 → 预检失败不阻塞保存，与 console 同语义）
// builtin 频道表单 = lib/channel-field-templates.ts（单一数据表+通用渲染器，字段集=pydantic 正源）。
// 降级：Controller 无端点 / qwenpaw 无 channel router → 404 → 占位横幅（版本门双源）。

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  QrCode,
  RefreshCw,
  RotateCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  buildChannelFields,
  IS_BUILTIN_KEY,
  type ChannelFieldSpec,
} from '@/lib/channel-field-templates';

type LocalizedText = string | Record<string, string>;

function localize(t: LocalizedText | undefined): string {
  if (t == null) return '';
  if (typeof t === 'string') return t;
  return t.zh ?? t['zh-CN'] ?? t.en ?? t['en-US'] ?? Object.values(t)[0] ?? '';
}

interface ChannelField {
  name: string;
  label?: LocalizedText;
  type: ChannelFieldSpec['type'];
  required?: boolean;
  placeholder?: LocalizedText;
  help?: LocalizedText;
  options?: string[];
}

interface ChannelSchema {
  label: string;
  description: string;
  config_fields: ChannelField[];
}

type ChannelsMap = Record<string, Record<string, unknown>>;
type HealthInfo = { channel: string; status: 'healthy' | 'unhealthy' | 'disabled'; detail?: string };
type ConflictAgent = { agent_id: string; agent_name: string };

type LoadState = 'loading' | 'ready' | 'unavailable' | 'error';

interface QrState {
  channel: string;
  img: string;
  token: string;
  status: 'waiting' | 'success' | 'fail' | 'expired';
  credentials: Record<string, string>;
}

const base = (workerName: string) => `/api/agentteams/workers/${encodeURIComponent(workerName)}/channels`;

// QR 登录只存在于这 5 个频道（QwenPaw QRCODE_AUTH_HANDLERS，
// qrcode_auth_handler.py:826 实读；其余频道无 handler → qrcode 端点恒 404）
const QR_CHANNELS = new Set(['wechat', 'wecom', 'dingtalk', 'feishu', 'qq']);

export function WorkerChannelsPanel({ workerName }: { workerName: string }) {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [channels, setChannels] = useState<ChannelsMap>({});
  const [types, setTypes] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<Record<string, ChannelSchema>>({});
  const [health, setHealth] = useState<Record<string, HealthInfo>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saveMsg, setSaveMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [qr, setQr] = useState<QrState | null>(null);
  const [qrError, setQrError] = useState('');
  const [conflictPrompt, setConflictPrompt] = useState<{
    channel: string;
    agents: ConflictAgent[];
    payload: Record<string, unknown>;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 供回调内刷新 health 用（避免闭包旧值）。ref 写在 effect 里（禁 render 期写 ref）。
  const channelsRef = useRef(channels);
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPoll, [stopPoll]);

  const loadHealth = useCallback(async (map: ChannelsMap) => {
    const next: Record<string, HealthInfo> = {};
    await Promise.all(
      Object.keys(map)
        .filter((ch) => map[ch]?.enabled === true)
        .map(async (ch) => {
          try {
            const res = await fetch(`${base(workerName)}/${encodeURIComponent(ch)}/health`, { cache: 'no-store' });
            if (res.ok) next[ch] = (await res.json()) as HealthInfo;
          } catch {
            // 单频道 health 失败不阻塞列表
          }
        }),
    );
    setHealth(next);
  }, [workerName]);

  const load = useCallback(async () => {
    try {
      const [resCh, resTypes, resSchemas] = await Promise.all([
        fetch(base(workerName), { cache: 'no-store' }),
        fetch(`${base(workerName)}/types`, { cache: 'no-store' }),
        fetch(`${base(workerName)}/schemas`, { cache: 'no-store' }),
      ]);
      if (resCh.status === 404 || resTypes.status === 404 || resSchemas.status === 404) {
        setState('unavailable');
        return;
      }
      if (!resCh.ok || !resTypes.ok || !resSchemas.ok) {
        throw new Error(`HTTP ${[resCh, resTypes, resSchemas].map((r) => r.status).join('/')}`);
      }
      const map = (await resCh.json()) as ChannelsMap;
      const ts = (await resTypes.json()) as string[];
      const sc = (await resSchemas.json()) as Record<string, ChannelSchema>;
      setChannels(map);
      setTypes(ts);
      setSchemas(sc);
      setState('ready');
      void loadHealth(map);
    } catch (err) {
      setState('error');
      setLoadError(err instanceof Error ? err.message : '加载失败');
    }
  }, [workerName, loadHealth]);

  // 延迟一个宏任务（同 B5：避免 effect 同步阶段进入 load 的 setState 链）
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // ── 编辑/保存 ───────────────────────────────────────────────────
  // 表单字段双路：/schemas 有该频道（插件频道）→ schema 驱动；
  // 无（builtin 频道，服务端无 config_fields）→ 模板表（channel-field-templates）。
  const fieldsFor = useCallback(
    (ch: string): ChannelField[] => {
      const schema = schemas[ch];
      if (schema?.config_fields?.length) return schema.config_fields;
      return buildChannelFields(ch, channels[ch]).map((f) => ({
        ...f,
        label: f.name as LocalizedText,
      }));
    },
    [channels, schemas],
  );

  const openEdit = useCallback(
    (ch: string) => {
      setSaveMsg(null);
      setConflictPrompt(null);
      const cur = { ...(channels[ch] ?? {}) };
      delete cur[IS_BUILTIN_KEY]; // API 元数据，不入 PUT body（console 同款剥离）
      setDraft(cur);
      setEditing(ch);
    },
    [channels],
  );

  const setField = useCallback((name: string, value: unknown) => {
    setDraft((d) => ({ ...d, [name]: value }));
  }, []);

  const doPut = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!editing) return;
      setSaving(true);
      setSaveMsg(null);
      try {
        const res = await fetch(`${base(workerName)}/${encodeURIComponent(editing)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const body = (await res.json()) as { detail?: string; error?: string; message?: string };
            if (typeof body.detail === 'string' && body.detail) detail = body.detail;
            else if (typeof body.message === 'string' && body.message) detail = body.message;
            else if (typeof body.error === 'string' && body.error) detail = body.error;
          } catch {
            // non-JSON
          }
          setSaveMsg({ kind: 'err', text: `保存失败：${detail}` });
          return;
        }
        const persisted = res.headers.get('x-agentteams-minio-persisted') ?? 'skipped';
        // 读回验证（插件同款）：保存后 GET，比对发出 payload 的每个键
        // （只比发出的键——服务端对未发字段补默认值，全量比对会假不一致）
        let readbackNote = '';
        try {
          const rb = await fetch(`${base(workerName)}/${encodeURIComponent(editing)}`, { cache: 'no-store' });
          if (rb.ok) {
            const got = (await rb.json()) as Record<string, unknown>;
            const mismatch = Object.keys(payload).filter(
              (f) => String(payload[f] ?? '') !== String(got[f] ?? ''),
            );
            readbackNote = mismatch.length > 0 ? `读回不一致（${mismatch.join(', ')}），请手动核对` : '读回验证通过';
          }
        } catch {
          readbackNote = '读回验证不可用';
        }
        const persistNote =
          persisted === 'true' ? 'MinIO 基线已收敛' : persisted === 'false' ? 'MinIO 基线未收敛（参考值，非写失败）' : 'MinIO 读回跳过';
        setSaveMsg({ kind: 'ok', text: `已保存 · ${readbackNote} · ${persistNote}` });
        setChannels((prev) => ({ ...prev, [editing]: { ...prev[editing], ...payload } }));
        setEditing(null);
        void loadHealth({ ...channelsRef.current, [editing]: { ...channelsRef.current[editing], ...payload } });
      } catch (err) {
        setSaveMsg({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' });
      } finally {
        setSaving(false);
      }
    },
    [editing, loadHealth, workerName],
  );

  const handleSave = useCallback(async () => {
    if (!editing || saving) return;
    const payload: Record<string, unknown> = { ...draft };
    delete payload[IS_BUILTIN_KEY];
    // console 频道保存强制 enabled（mirror console keepConsoleEnabled——
    // 防把 worker 自己的 console 频道关掉）
    if (editing === 'console') payload.enabled = true;
    // conflict-check 预检（mirror console handleSubmit：仅 enabled 时查；
    // 2.0.x worker 无此路由 → 上游 404 透传 = 版本门 → warn 继续，不阻塞保存）
    if (payload.enabled === true) {
      try {
        const c = await fetch(`${base(workerName)}/${encodeURIComponent(editing)}/conflict-check`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (c.ok) {
          const body = (await c.json()) as { conflict?: boolean; agents?: ConflictAgent[] };
          if (body.conflict && (body.agents?.length ?? 0) > 0) {
            setConflictPrompt({ channel: editing, agents: body.agents as ConflictAgent[], payload });
            return;
          }
        } else {
          console.warn(`conflict-check unavailable (HTTP ${c.status}); saving without preflight`);
        }
      } catch (err) {
        console.warn('conflict-check failed; saving without preflight', err);
      }
    }
    void doPut(payload);
  }, [draft, doPut, editing, saving, workerName]);

  const confirmConflictSave = useCallback(() => {
    if (!conflictPrompt) return;
    const { payload } = conflictPrompt;
    setConflictPrompt(null);
    void doPut(payload);
  }, [conflictPrompt, doPut]);

  // ── restart ────────────────────────────────────────────────────
  const [restartMsg, setRestartMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const handleRestart = useCallback(
    async (ch: string) => {
      setRestartMsg(null);
      try {
        const res = await fetch(`${base(workerName)}/${encodeURIComponent(ch)}/restart`, { method: 'POST' });
        if (!res.ok) {
          setRestartMsg({ kind: 'err', text: `restart 失败：HTTP ${res.status}` });
          return;
        }
        const body = (await res.json().catch(() => null)) as { status?: string; detail?: string } | null;
        setRestartMsg({ kind: 'ok', text: `已重启频道（${body?.status ?? 'restarted'}）` });
        void loadHealth(channelsRef.current);
      } catch (err) {
        setRestartMsg({ kind: 'err', text: err instanceof Error ? err.message : 'restart 失败' });
      }
    },
    [loadHealth, workerName],
  );

  // ── 二维码登录（wechat/dingtalk 扫描流）────────────────────────
  const handleQrcode = useCallback(async (ch: string) => {
    stopPoll();
    setQr(null);
    setQrError('');
    try {
      const res = await fetch(`${base(workerName)}/${encodeURIComponent(ch)}/qrcode`, { cache: 'no-store' });
      if (res.status === 404) {
        setQrError('该频道不支持二维码登录（或 qwenpaw 版本无此路由）');
        return;
      }
      if (!res.ok) {
        setQrError(`二维码获取失败：HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as { qrcode_img: string; poll_token: string };
      setQr({ channel: ch, img: body.qrcode_img, token: body.poll_token, status: 'waiting', credentials: {} });
      pollRef.current = setInterval(async () => {
        try {
          const s = await fetch(
            `${base(workerName)}/${encodeURIComponent(ch)}/qrcode/status?token=${encodeURIComponent(body.poll_token)}`,
            { cache: 'no-store' },
          );
          if (!s.ok) return;
          const st = (await s.json()) as { status: QrState['status']; credentials: Record<string, string> };
          setQr((prev) => (prev ? { ...prev, status: st.status, credentials: st.credentials ?? {} } : prev));
          if (st.status !== 'waiting') stopPoll();
        } catch {
          // 单次轮询失败忽略
        }
      }, 2000);
    } catch (err) {
      setQrError(err instanceof Error ? err.message : '二维码获取失败');
    }
  }, [stopPoll, workerName]);

  const writeBackCredentials = useCallback(async () => {
    if (!qr || qr.status !== 'success') return;
    const current = { ...(channelsRef.current[qr.channel] ?? {}) };
    delete current[IS_BUILTIN_KEY];
    const merged = { ...current, ...qr.credentials };
    try {
      const res = await fetch(`${base(workerName)}/${encodeURIComponent(qr.channel)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(merged),
      });
      if (!res.ok) {
        setQrError(`凭证回写失败：HTTP ${res.status}`);
        return;
      }
      setChannels((prev) => ({ ...prev, [qr.channel]: merged }));
      setQr(null);
      setSaveMsg({ kind: 'ok', text: '扫码凭证已回写并热加载' });
    } catch (err) {
      setQrError(err instanceof Error ? err.message : '凭证回写失败');
    }
  }, [qr, workerName]);

  // ── 渲染 ───────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        频道配置加载中…
      </div>
    );
  }

  if (state === 'unavailable') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>当前 Controller 未提供频道端点，或该 Worker 的 QwenPaw 版本过旧（无 channel 路由）。升级 AgentTeams / Worker 运行时后自动生效。</span>
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

  const ordered = types.length > 0
    ? types
    : Object.keys(schemas).concat(Object.keys(channels).filter((c) => !schemas[c]));

  return (
    <div className="space-y-2 pt-2">
      <p className="text-muted-foreground">频道接入（#1219）</p>

      <div className="space-y-1">
        {ordered.map((ch) => {
          const cfg = channels[ch] ?? {};
          const schema = schemas[ch];
          const h = health[ch];
          const isEditing = editing === ch;
          const fields = isEditing ? fieldsFor(ch) : [];
          return (
            <div key={ch} className="rounded-md border border-border/60">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs hover:underline"
                  onClick={() => {
                    setSaveMsg(null);
                    setRestartMsg(null);
                    if (isEditing) setEditing(null);
                    else openEdit(ch);
                  }}
                >
                  {isEditing ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : <ChevronRight className="h-3 w-3" aria-hidden="true" />}
                  <span className="font-medium">{schema?.label || ch}</span>
                </button>
                <span className="text-xs text-muted-foreground">{ch}</span>
                <HealthDot info={h} enabled={cfg.enabled === true} />
                <div className="ml-auto flex items-center gap-1">
                  {QR_CHANNELS.has(ch) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-xs"
                      onClick={() => void handleQrcode(ch)}
                    >
                      <QrCode className="mr-1 h-3 w-3" aria-hidden="true" />
                      扫码
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs"
                    onClick={() => void handleRestart(ch)}
                  >
                    <RotateCw className="mr-1 h-3 w-3" aria-hidden="true" />
                    重启
                  </Button>
                </div>
              </div>
              {isEditing && (
                <div className="space-y-2 border-t border-border/60 p-2">
                  {fields.map((f) => (
                    <label key={f.name} className="block space-y-0.5">
                      <span className="text-xs text-muted-foreground">
                        {localize(f.label) || f.name}
                        {f.required ? ' *' : ''}
                      </span>
                      <FieldControl field={f} value={draft[f.name]} onChange={(v) => setField(f.name, v)} />
                      {f.help ? <span className="block text-xs text-muted-foreground">{localize(f.help)}</span> : null}
                    </label>
                  ))}
                  {conflictPrompt && conflictPrompt.channel === ch && (
                    <div className="space-y-1.5 rounded-md border border-red-300 bg-red-50 p-2 dark:border-red-800 dark:bg-red-950/40">
                      <p className="text-xs text-red-700 dark:text-red-300">
                        Bot 冲突：
                        {conflictPrompt.agents
                          .map((a) => (a.agent_name && a.agent_name !== a.agent_id ? `${a.agent_name} (${a.agent_id})` : a.agent_id))
                          .join('、')}
                        正在使用相同的 Bot 凭据，保存后对方将被挤下线。
                      </p>
                      <div className="flex items-center gap-2">
                        <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={confirmConflictSave}>
                          仍要保存
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setConflictPrompt(null)}>
                          取消
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="h-7 text-xs" disabled={saving} onClick={() => void handleSave()}>
                      {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" /> : <Check className="mr-1 h-3 w-3" aria-hidden="true" />}
                      保存（热加载免重启）
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(null)}>
                      取消
                    </Button>
                  </div>
                </div>
              )}
              {/* 二维码块行级渲染（「扫码」按钮在行头，未展开编辑也须可见） */}
              {qr && qr.channel === ch && (
                <div className="space-y-1 border-t border-border/60 p-2">
                  <img
                    src={`data:image/png;base64,${qr.img}`}
                    alt={`扫码登录 ${ch}`}
                    className="h-40 w-40"
                  />
                  <p className="text-xs text-muted-foreground">
                    {qr.status === 'waiting' && '等待扫码…'}
                    {qr.status === 'success' && '扫码成功，可回写凭证。'}
                    {qr.status === 'fail' && '扫码失败，请重试。'}
                    {qr.status === 'expired' && '二维码已过期，请重新获取。'}
                  </p>
                  {qr.status === 'success' && (
                    <Button size="sm" className="h-7 text-xs" onClick={() => void writeBackCredentials()}>
                      回写凭证
                    </Button>
                  )}
                </div>
              )}
              {qrError && <MsgLine msg={{ kind: 'err', text: qrError }} />}
            </div>
          );
        })}
      </div>

      {/* 消息面板级渲染（单例，列表下方——编辑区关闭后仍可见） */}
      {saveMsg && <MsgLine msg={saveMsg} />}
      {restartMsg && <MsgLine msg={restartMsg} />}
    </div>
  );
}

function HealthDot({ info, enabled }: { info?: HealthInfo; enabled: boolean }) {
  if (!enabled) return <span className="text-xs text-muted-foreground">未启用</span>;
  const cls =
    info?.status === 'healthy'
      ? 'bg-emerald-500'
      : info?.status === 'unhealthy'
        ? 'bg-red-500'
        : info?.status === 'disabled'
          ? 'bg-muted-foreground/40'
          : 'bg-amber-400';
  return (
    <span
      title={info?.detail || info?.status || '健康检查中…'}
      className={`inline-block h-2 w-2 rounded-full ${cls}`}
      aria-label={info?.status || 'checking'}
    />
  );
}

function MsgLine({ msg }: { msg: { kind: 'ok' | 'err'; text: string } }) {
  return (
    <p
      className={`flex items-start gap-1 text-xs ${
        msg.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
      }`}
    >
      {msg.kind === 'ok' ? <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> : <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />}
      <span>{msg.text}</span>
    </p>
  );
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: ChannelField;
  value: unknown;
  onChange: (_v: unknown) => void;
}) {
  if (field.type === 'switch') {
    return (
      <input
        type="checkbox"
        className="h-4 w-4"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (field.type === 'select') {
    return (
      <select
        className="h-8 w-full rounded-md border bg-transparent px-2 text-xs"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">（空）</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'list') {
    return (
      <Input
        type="text"
        className="h-8 text-xs"
        value={Array.isArray(value) ? value.map((v) => String(v)).join(', ') : String(value ?? '')}
        placeholder={localize(field.placeholder) || '逗号分隔，如：@alice:example.org, @bob:example.org'}
        onChange={(e) => {
          const t = e.target.value;
          onChange(t.trim() === '' ? [] : t.split(',').map((s) => s.trim()).filter(Boolean));
        }}
      />
    );
  }
  if (field.type === 'json') {
    const text =
      value == null || (typeof value === 'object' && Object.keys(value as object).length === 0)
        ? ''
        : JSON.stringify(value, null, 2);
    return (
      <textarea
        className="h-20 w-full rounded-md border bg-transparent px-2 py-1 font-mono text-xs"
        value={text}
        placeholder='JSON 对象，如：{"!room:example.org": {"require_mention": true}}'
        onChange={(e) => {
          const t = e.target.value.trim();
          if (t === '') {
            onChange({});
            return;
          }
          try {
            onChange(JSON.parse(t));
          } catch {
            // 非法 JSON 不入 draft（输入显示回退到上次有效值）
          }
        }}
      />
    );
  }
  const type = field.type === 'number' ? 'number' : field.type === 'password' ? 'password' : 'text';
  return (
    <Input
      type={type}
      className="h-8 text-xs"
      value={String(value ?? '')}
      placeholder={localize(field.placeholder)}
      onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
    />
  );
}
