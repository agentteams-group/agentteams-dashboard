'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Brain, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { agentteamsApi, type HumanConfigRecord } from '@/lib/agentteams-api';
import { ApiError, formatErrorMessage } from '@/lib/api-error';
import { useModelSelection } from '@/hooks/use-model-selection';
import {
  MODEL_ACCESS_ROLES,
  allSurfacesLocked,
  buildModelAccessPayload,
  capabilitiesFromHumanRecord,
  draftFromHumanRecord,
  emptyScope,
  findPairIssues,
  type ModelAccessCliDraft,
  type ModelAccessDraft,
  type ModelAccessPair,
  type ModelAccessScopeDraft,
} from '@/lib/model-access';
import {
  buildModelCandidateCatalog,
  modelOptionsForProvider,
  type ModelCandidateCatalog,
} from '@/lib/model-catalog';
import { toast } from 'sonner';

const CLI_OPTIONS = ['qwen-code', 'opencode', 'qoder'] as const;
const NO_TABLE = '__none__';
// Radix Select forbids an empty-string item value; the wire value for the
// default role is "" (all roles), so the trigger uses a sentinel.
const DEFAULT_ROLE = '__default__';

function PairRows({
  entries,
  catalog,
  disabled,
  onChange,
}: {
  entries: ModelAccessPair[];
  catalog: ModelCandidateCatalog;
  disabled: boolean;
  onChange: (_next: ModelAccessPair[]) => void;
}) {
  const patch = (index: number, next: ModelAccessPair) =>
    onChange(entries.map((item, i) => (i === index ? next : item)));
  return (
    <div className="space-y-1.5">
      {entries.map((entry, index) => {
        // 两者一填一空 = 不完整行：行内红字先提示，保存门另有汇总拦截。
        const incomplete = Boolean(entry.provider.trim()) !== Boolean(entry.model.trim());
        return (
          <div key={index} className="space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Combobox
                value={entry.provider}
                options={catalog.providers}
                ariaLabel={`provider ${index + 1}`}
                placeholder="provider（如 higress）"
                className="min-w-[120px] flex-1"
                disabled={disabled}
                onChange={(provider) => patch(index, { ...entry, provider })}
              />
              <Combobox
                value={entry.model}
                options={modelOptionsForProvider(catalog, entry.provider)}
                ariaLabel={`model ${index + 1}`}
                placeholder="model（路由 alias）"
                className="min-w-[120px] flex-1"
                disabled={disabled}
                onChange={(model) =>
                  patch(index, {
                    ...entry,
                    model,
                    // 选模型时按 binding 反查 provider；已填 provider 不覆盖。
                    provider:
                      entry.provider.trim() || !model.trim()
                        ? entry.provider
                        : (catalog.providerByModel[model.trim()] ?? ''),
                  })
                }
              />
              <Button
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11 shrink-0 text-muted-foreground"
                aria-label={`删除模型行 ${index + 1}`}
                disabled={disabled}
                onClick={() => onChange(entries.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
            {incomplete && (
              <p className="text-xs text-destructive">provider 与 model 需成对填写</p>
            )}
          </div>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        className="min-h-11"
        disabled={disabled}
        onClick={() => onChange([...entries, { provider: '', model: '' }])}
      >
        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        添加 (provider, model)
      </Button>
    </div>
  );
}

function SurfaceSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5 rounded-md border border-border/70 p-2.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-semibold">{title}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ScopeEditor({
  scope,
  index,
  tables,
  catalog,
  disabled,
  onChange,
  onRemove,
}: {
  scope: ModelAccessScopeDraft;
  index: number;
  tables: string[];
  catalog: ModelCandidateCatalog;
  disabled: boolean;
  onChange: (_next: ModelAccessScopeDraft) => void;
  onRemove: () => void;
}) {
  const tableOptions = scope.table && !tables.includes(scope.table)
    ? [...tables, scope.table]
    : tables;
  const usedClis = scope.codingCli.map((cli) => cli.cli);
  const freeClis = CLI_OPTIONS.filter((cli) => !usedClis.includes(cli));
  const setCli = (cliIndex: number, next: ModelAccessCliDraft) => {
    onChange({
      ...scope,
      codingCli: scope.codingCli.map((item, i) => (i === cliIndex ? next : item)),
    });
  };

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold">作用域 {index + 1}</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto min-h-11 text-destructive hover:text-destructive"
          onClick={onRemove}
          disabled={disabled}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          移除作用域
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">角色</Label>
          <Select
            value={scope.role || DEFAULT_ROLE}
            onValueChange={(value) =>
              onChange({ ...scope, role: value === DEFAULT_ROLE ? '' : value })
            }
            disabled={disabled}
          >
            <SelectTrigger className="w-full" aria-label={`作用域 ${index + 1} 角色`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODEL_ACCESS_ROLES.map((role) => (
                <SelectItem key={role.value || DEFAULT_ROLE} value={role.value || DEFAULT_ROLE}>
                  {role.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">共享表（可选）</Label>
          <Select
            value={scope.table || NO_TABLE}
            onValueChange={(value) =>
              onChange({ ...scope, table: value === NO_TABLE ? '' : value })
            }
            disabled={disabled}
          >
            <SelectTrigger className="w-full" aria-label={`作用域 ${index + 1} 共享表`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TABLE}>不使用共享表（内联授权）</SelectItem>
              {tableOptions.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {scope.table ? (
        <p className="text-xs text-muted-foreground">
          共享表与内联授权二选一：当前作用域只引用表「{scope.table}」，内联配置不写入。
        </p>
      ) : (
        <div className="space-y-2">
          <SurfaceSection title="主模型" hint="(provider, model) 成对；空 = 全锁">
            <PairRows
              entries={scope.main}
              catalog={catalog}
              disabled={disabled}
              onChange={(main) => onChange({ ...scope, main })}
            />
          </SurfaceSection>

          <SurfaceSection title="spawn" hint="空值可继承主模型">
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={scope.spawn.inherit === true}
                onCheckedChange={(checked) =>
                  onChange({ ...scope, spawn: { ...scope.spawn, inherit: checked || undefined } })
                }
                disabled={disabled}
                aria-label={`作用域 ${index + 1} spawn 继承`}
              />
              继承主模型（不再填 entries）
            </label>
            {!scope.spawn.inherit && (
              <PairRows
                entries={scope.spawn.entries}
                catalog={catalog}
                disabled={disabled}
                onChange={(entries) => onChange({ ...scope, spawn: { ...scope.spawn, entries } })}
              />
            )}
          </SurfaceSection>

          <SurfaceSection title="Coding CLI" hint="qwen-code / opencode / qoder">
            <div className="space-y-2">
              {scope.codingCli.map((cli, cliIndex) => (
                <div key={cliIndex} className="space-y-1.5 rounded-md border border-dashed p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={cli.cli}
                      onValueChange={(value) => setCli(cliIndex, { ...cli, cli: value })}
                      disabled={disabled}
                    >
                      <SelectTrigger className="w-[150px]" aria-label={`CLI ${cliIndex + 1}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(CLI_OPTIONS.includes(cli.cli as (typeof CLI_OPTIONS)[number])
                          ? [...CLI_OPTIONS]
                          : [cli.cli, ...CLI_OPTIONS]
                        ).map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={cli.inherit === true}
                        onCheckedChange={(checked) =>
                          setCli(cliIndex, { ...cli, inherit: checked || undefined })
                        }
                        disabled={disabled}
                        aria-label={`CLI ${cliIndex + 1} 继承`}
                      />
                      继承
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto min-h-11 text-destructive hover:text-destructive"
                      onClick={() =>
                        onChange({
                          ...scope,
                          codingCli: scope.codingCli.filter((_, i) => i !== cliIndex),
                        })
                      }
                      disabled={disabled}
                    >
                      移除 CLI
                    </Button>
                  </div>
                  {!cli.inherit && (
                    <PairRows
                      entries={cli.entries}
                      catalog={catalog}
                      disabled={disabled}
                      onChange={(entries) => setCli(cliIndex, { ...cli, entries })}
                    />
                  )}
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="min-h-11"
                disabled={disabled || freeClis.length === 0}
                onClick={() =>
                  onChange({
                    ...scope,
                    codingCli: [...scope.codingCli, { cli: freeClis[0], entries: [] }],
                  })
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                添加 CLI
              </Button>
            </div>
          </SurfaceSection>
        </div>
      )}
    </div>
  );
}

export function HumanModelAccessDialog({
  open,
  humanName,
  record,
  canManage,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  humanName: string;
  record: HumanConfigRecord | null;
  canManage: boolean;
  onOpenChange: (_open: boolean) => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ModelAccessDraft>(() => draftFromHumanRecord(record));
  const [dirty, setDirty] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    agentteamsApi
      .listModelAccessTables()
      .then((result) => {
        if (alive) setTables(result.tables);
      })
      .catch(() => {
        if (alive) setTables([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const capabilities = capabilitiesFromHumanRecord(record);
  const locked = allSurfacesLocked(capabilities);
  const readOnly = !canManage || locked;
  const issues = findPairIssues(draft);
  // provider / model 候选与其它模型编辑入口同源（use-model-selection）。
  // 候选为空（Console 会话失效 / 未配路由）时 Combobox 仍可自由输入。
  const modelSelection = useModelSelection();
  const catalog = useMemo(
    () => buildModelCandidateCatalog(modelSelection.options),
    [modelSelection.options],
  );

  const updateScope = (index: number, next: ModelAccessScopeDraft) => {
    setDirty(true);
    setDraft((prev) => ({
      scopes: prev.scopes.map((scope, i) => (i === index ? next : scope)),
    }));
  };

  const save = async () => {
    if (readOnly || busy || issues.length > 0) return;
    setBusy(true);
    setError('');
    try {
      await agentteamsApi.saveHumanModelAccess(humanName, buildModelAccessPayload(draft));
      toast.success('模型授权已保存');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      const prefix = err instanceof ApiError && err.status === 403 ? '403 无权限：' : '';
      setError(`${prefix}${formatErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-[95vw] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            模型授权 · {humanName}
          </DialogTitle>
          <DialogDescription>
            读-改-写只更新 spec.modelAccess；无有效作用域 = fail-closed（该人员名下 Worker 默认全部模型锁定）。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-3 overflow-y-auto py-1">
          {readOnly && (
            <p role="status" className="rounded-md border border-status-waiting/30 bg-status-waiting/5 p-2 text-xs text-status-waiting">
              只读（403）：{locked ? '当前授权由上游继承或策略限制。' : '需要 L1 管理员权限才能修改模型授权。'}
            </p>
          )}
          {error && (
            <p role="alert" className="break-words rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {error}
            </p>
          )}
          {draft.scopes.length === 0 && (
            <p className="rounded-md border border-status-waiting/30 bg-status-waiting/5 p-2 text-xs text-status-waiting">
              未配置模型授权（fail-closed）：添加作用域并授权 (provider, model) 对后保存。
            </p>
          )}
          {issues.length > 0 && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              有 {issues.length} 行 (provider, model) 不完整——补全或删除后再保存。
            </p>
          )}

          {draft.scopes.map((scope, index) => (
            <ScopeEditor
              key={index}
              scope={scope}
              index={index}
              tables={tables}
              catalog={catalog}
              disabled={readOnly || busy}
              onChange={(next) => updateScope(index, next)}
              onRemove={() => {
                setDirty(true);
                setDraft((prev) => ({
                  scopes: prev.scopes.filter((_, i) => i !== index),
                }));
              }}
            />
          ))}

          <Button
            variant="outline"
            className="min-h-11"
            disabled={readOnly || busy}
            onClick={() => {
              setDirty(true);
              setDraft((prev) => ({ scopes: [...prev.scopes, emptyScope()] }));
            }}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            添加作用域
          </Button>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            取消
          </Button>
          <Button
            className="min-h-11"
            onClick={() => void save()}
            disabled={readOnly || busy || issues.length > 0 || !dirty}
          >
            {busy ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
