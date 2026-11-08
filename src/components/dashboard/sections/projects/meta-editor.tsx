'use client';

// 项目/任务 meta（meta.json）编辑弹窗 —— 项目卡片 / 工作流详情 / 任务行三处共用
// 同一套（对齐工作台插件 16.113 MetaEditorModal）。
//
// 行为：
//   - 打开即 GET 原文 + ETag（pretty 展示；空 meta 显示 {}），
//   - 保存 = PUT + If-Match；成功 → toast + onSaved（调用方刷新）→ 关闭；
//   - 409 conflict → 保留编辑内容，自动重读一次换新 ETag，提示「已被他人修改，
//     重读/覆盖」（重读 = 放弃改动，覆盖 = 以新 ETag 再保存一次）；
//   - 400/403 等原样展示服务端错误；
//   - 405/404（老 Controller 路由未部署 / 目标消失）→ 静默关窗 + 隐藏入口。

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { agentteamsApi } from '@/lib/agentteams-api';
import {
  META_MAX_BYTES,
  classifyMetaError,
  formatMetaText,
  isMetaEndpointUnavailable,
  validateMetaJson,
  type MetaValidationError,
} from '@/lib/meta-api';
import { cn } from '@/lib/utils';

export type MetaKind = 'project' | 'task';

const VALIDATION_TEXT: Record<MetaValidationError, string> = {
  empty: 'meta 不能为空（清空请用空对象 {}）',
  invalid_json: '不是合法 JSON，无法保存',
  not_object: 'meta 必须是 JSON 对象（不接受数组/标量）',
  oversize: `内容超过 ${META_MAX_BYTES / 1024} KiB，已拒绝保存（请精简）`,
};

interface Notice {
  tone: 'ok' | 'error' | 'warn';
  text: string;
}

const NOTICE_TONE: Record<Notice['tone'], string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  error: 'text-red-700 dark:text-red-400',
};

type Phase = 'loading' | 'ready' | 'error';

export interface MetaEditorModalProps {
  open: boolean;
  kind: MetaKind;
  /** 项目 id 或任务 id。 */
  id: string;
  /** 弹窗标题里的显示名（缺省用 id）。 */
  title?: string;
  /** 任务 meta 的团队消歧键（?team=）。 */
  teamId?: string;
  onOpenChange: (_next: boolean) => void;
  /** 端点不可用（405/404）→ 父级隐藏入口（静默）。 */
  onUnsupported?: () => void;
  /** 保存成功 → 调用方刷新项目/任务数据。 */
  onSaved?: () => void;
}

export function MetaEditorModal({
  open,
  kind,
  id,
  title,
  teamId,
  onOpenChange,
  onUnsupported,
  onSaved,
}: MetaEditorModalProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [text, setText] = useState('');
  const [etag, setEtag] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const kindLabel = kind === 'task' ? '任务 meta' : '项目 meta';

  // keepText = 冲突自动重读（只换新 ETag，不覆盖用户编辑文本）。
  const read = useCallback(
    async (opts?: { keepText?: boolean; keepNotice?: boolean }) => {
      setPhase('loading');
      if (!opts?.keepNotice) setNotice(null);
      try {
        const res =
          kind === 'project'
            ? await agentteamsApi.getProjectMeta(id)
            : await agentteamsApi.getTaskMeta(id, teamId);
        if (!opts?.keepText) {
          setText(formatMetaText(res.raw));
          setConflict(false);
        }
        setEtag(res.etag);
        setPhase('ready');
      } catch (e) {
        if (isMetaEndpointUnavailable(e)) {
          onUnsupported?.();
          onOpenChange(false);
          return;
        }
        if (classifyMetaError(e) === 'ambiguous') {
          setPhase('error');
          setNotice({
            tone: 'error',
            text: '同一任务存在于多个团队（409 ambiguous_task），请从带团队归属的入口重试',
          });
          return;
        }
        setPhase('error');
        setNotice({
          tone: 'error',
          text:
            classifyMetaError(e) === 'forbidden'
              ? '无权限读取 meta'
              : e instanceof Error
                ? e.message
                : '加载 meta 失败',
        });
      }
    },
    [kind, id, teamId, onUnsupported, onOpenChange],
  );

  // 打开 / 切换目标 → 重置并重新 GET（ETag 可能已变，必须是新鲜读）。
  useEffect(() => {
    if (!open) return;
    setText('');
    setEtag('');
    setSaving(false);
    setConflict(false);
    setNotice(null);
    void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, id, teamId]);

  const validation = useMemo(() => validateMetaJson(text), [text]);

  const save = useCallback(async () => {
    if (phase !== 'ready' || !validation.ok || !etag || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const res =
        kind === 'project'
          ? await agentteamsApi.saveProjectMeta(id, text, etag)
          : await agentteamsApi.saveTaskMeta(id, text, etag, teamId);
      setEtag(res.etag || etag);
      toast.success('meta 已保存');
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      if (isMetaEndpointUnavailable(e)) {
        onUnsupported?.();
        onOpenChange(false);
        return;
      }
      const why = classifyMetaError(e);
      if (why === 'conflict') {
        setConflict(true);
        setNotice({
          tone: 'warn',
          text: '已被他人修改（409），编辑内容已保留：点「重读」放弃自己的修改，或点「覆盖」以最新版本为基线保存。',
        });
        // 自动重读一次：只刷新 ETag，用户文本原样保留。
        void read({ keepText: true, keepNotice: true });
        return;
      }
      if (why === 'ambiguous') {
        setNotice({
          tone: 'error',
          text: '同一任务存在于多个团队（409 ambiguous_task），请从带团队归属的入口重试',
        });
        return;
      }
      // 400 / 403 / 428 / 5xx：原样展示服务端错误。
      setNotice({
        tone: 'error',
        text: e instanceof Error ? e.message : '保存 meta 失败',
      });
    } finally {
      setSaving(false);
    }
  }, [
    phase,
    validation.ok,
    etag,
    saving,
    kind,
    id,
    text,
    teamId,
    onSaved,
    onOpenChange,
    onUnsupported,
    read,
  ]);

  const canSave = phase === 'ready' && validation.ok && !!etag && !saving;

  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {kindLabel} — {title || id}
          </DialogTitle>
          <DialogDescription>
            meta.json 原文（pretty）。保存走 ETag / If-Match 并发保护：版本已被修改会返回
            409，此时可重读或覆盖。
          </DialogDescription>
        </DialogHeader>

        {phase === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载 meta…
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-2">
            <p className={cn('text-xs', NOTICE_TONE.error)}>{notice?.text ?? '加载 meta 失败'}</p>
            <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => void read()}>
              重试
            </Button>
          </div>
        )}

        {phase === 'ready' && (
          <div className="space-y-2">
            <Textarea
              aria-label={`${kindLabel} JSON`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={14}
              spellCheck={false}
              className="font-mono text-xs"
            />
            {!validation.ok && (
              <p className={cn('text-xs', NOTICE_TONE.error)}>{VALIDATION_TEXT[validation.error]}</p>
            )}
            {notice && <p className={cn('text-xs', NOTICE_TONE[notice.tone])}>{notice.text}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-11 sm:h-8"
                onClick={() => void read()}
                disabled={saving}
              >
                重读
              </Button>
              <span className="text-xs text-muted-foreground font-mono break-all">
                ETag: {etag || '（无）'}
              </span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            className="h-11 sm:h-8"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            关闭
          </Button>
          <Button
            size="sm"
            className="h-11 sm:h-8"
            onClick={() => void save()}
            disabled={!canSave}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            {conflict ? '覆盖' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 405/404 → 该目标本会话内不再渲染入口（组件重挂载也保持隐藏）。
const unsupportedMetaTargets = new Set<string>();
const targetKey = (kind: MetaKind, id: string) => `${kind}:${id}`;

export interface MetaEditorEntryProps {
  kind: MetaKind;
  id: string;
  title?: string;
  teamId?: string;
  label?: string;
  className?: string;
  onSaved?: () => void;
  /** 卡片/行自身可点击时阻止事件冒泡（避免同时触发选中/展开）。 */
  stopPropagation?: boolean;
}

/** 「编辑 meta」入口：默认渲染，GET/PUT 返回 405/404 后静默隐藏（仅支持时可见）。 */
export function MetaEditorEntry({
  kind,
  id,
  title,
  teamId,
  label = '编辑 meta',
  className,
  onSaved,
  stopPropagation = true,
}: MetaEditorEntryProps) {
  const [supported, setSupported] = useState(
    () => !unsupportedMetaTargets.has(targetKey(kind, id)),
  );
  const [open, setOpen] = useState(false);

  if (!supported) return null;

  const handleOpen = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) event.stopPropagation();
    setOpen(true);
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (stopPropagation) event.stopPropagation();
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn('h-11 gap-1 text-xs sm:h-7', className)}
        onClick={handleOpen}
        onKeyDown={handleKeyDown}
        title={`编辑${kind === 'task' ? '任务' : '项目'} meta（JSON，ETag 并发保护）`}
      >
        <Pencil className="h-3 w-3" />
        {label}
      </Button>
      <MetaEditorModal
        open={open}
        kind={kind}
        id={id}
        title={title}
        teamId={teamId}
        onOpenChange={setOpen}
        onUnsupported={() => {
          unsupportedMetaTargets.add(targetKey(kind, id));
          setSupported(false);
        }}
        onSaved={onSaved}
      />
    </>
  );
}
