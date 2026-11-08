'use client';

import { useState } from 'react';
import { DoorOpen, Plus, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { agentteamsApi, type HumanConfigRecord } from '@/lib/agentteams-api';
import { ApiError, formatErrorMessage } from '@/lib/api-error';
import {
  MAX_PATHS_PER_RULE,
  MAX_RULES_PER_LIST,
  buildWorkspaceAccessPayload,
  extractWorkspaceAccess,
  validateAccess,
  type AccessIssue,
  type AccessMode,
  type WorkspaceAccess,
  type WorkspaceAccessRule,
} from '@/lib/workspace-access';
import { toast } from 'sonner';

const GRANT_MODES: AccessMode[] = ['read', 'readwrite'];
const RESTRICTION_MODES: AccessMode[] = ['none', 'read'];

function modeLabel(mode: AccessMode): string {
  if (mode === 'read') return '只读';
  if (mode === 'readwrite') return '读写';
  return '无权限';
}

function issueText(issue: AccessIssue): string {
  switch (issue.kind) {
    case 'bad_path':
      return `路径非法：${issue.detail ?? ''}`;
    case 'bad_mode':
      return `模式越界：${issue.detail ?? ''}（此列表允许 ${issue.list === 'grants' ? 'read / readwrite' : 'none / read'}）`;
    case 'dup_team':
      return '同一团队在列表中重复';
    case 'unknown_team':
      return `团队不存在：${issue.detail ?? ''}`;
    case 'empty_team':
      return '团队不可为空';
    case 'no_paths':
      return '至少需要一条路径';
    case 'too_many_rules':
      return `每列表至多 ${MAX_RULES_PER_LIST} 条规则（当前 ${issue.detail ?? ''}）`;
    case 'too_many_paths':
      return `每规则至多 ${MAX_PATHS_PER_RULE} 条路径（当前 ${issue.detail ?? ''}）`;
  }
}

function PathChips({
  paths,
  disabled,
  onChange,
}: {
  paths: string[];
  disabled: boolean;
  onChange: (_next: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const add = () => {
    const path = input.trim();
    if (!path) return;
    if (paths.includes(path)) {
      setInput('');
      return;
    }
    if (paths.length >= MAX_PATHS_PER_RULE) return;
    onChange([...paths, path]);
    setInput('');
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {paths.map((path, index) => (
          <span
            key={`${path}-${index}`}
            className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-xs sm:min-h-6"
          >
            <span className="min-w-0 break-all">{path}</span>
            <button
              type="button"
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 sm:size-4"
              aria-label={`移除路径 ${path}`}
              disabled={disabled}
              onClick={() => onChange(paths.filter((_, i) => i !== index))}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        {paths.length === 0 && <span className="text-xs text-muted-foreground">未配置路径</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          value={input}
          placeholder="添加路径（支持 * 和 **）"
          aria-label="添加路径"
          className="min-w-[160px] flex-1"
          disabled={disabled || paths.length >= MAX_PATHS_PER_RULE}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button
          variant="outline"
          className="min-h-11"
          disabled={disabled || paths.length >= MAX_PATHS_PER_RULE || input.trim() === ''}
          onClick={add}
        >
          添加
        </Button>
      </div>
      {paths.length >= MAX_PATHS_PER_RULE && (
        <p className="text-xs text-status-waiting">
          每规则至多 {MAX_PATHS_PER_RULE} 条路径，已达上限。
        </p>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  list,
  teamNames,
  disabled,
  issues,
  onChange,
  onRemove,
}: {
  rule: WorkspaceAccessRule;
  list: 'grants' | 'restrictions';
  teamNames: string[];
  disabled: boolean;
  issues: AccessIssue[];
  onChange: (_next: WorkspaceAccessRule) => void;
  onRemove: () => void;
}) {
  const modes = list === 'grants' ? GRANT_MODES : RESTRICTION_MODES;
  const teams = rule.team && !teamNames.includes(rule.team) ? [...teamNames, rule.team] : teamNames;
  return (
    <div className="space-y-2 rounded-md border border-dashed p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {teams.length > 0 ? (
          <Select
            value={rule.team || undefined}
            onValueChange={(value) => onChange({ ...rule, team: value })}
            disabled={disabled}
          >
            <SelectTrigger className="w-[170px]" aria-label="团队">
              <SelectValue placeholder="团队" />
            </SelectTrigger>
            <SelectContent>
              {teams.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={rule.team}
            aria-label="团队（自由输入）"
            placeholder="团队名（自由输入）"
            className="w-[170px]"
            disabled={disabled}
            onChange={(event) => onChange({ ...rule, team: event.target.value })}
          />
        )}
        <Select
          value={rule.mode}
          onValueChange={(value) => onChange({ ...rule, mode: value as AccessMode })}
          disabled={disabled}
        >
          <SelectTrigger className="w-[110px]" aria-label="模式">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {modes.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {modeLabel(mode)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto min-h-11 min-w-11 text-destructive hover:text-destructive"
          aria-label="删除规则"
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      <PathChips
        paths={rule.paths}
        disabled={disabled}
        onChange={(paths) => onChange({ ...rule, paths })}
      />
      {issues.length > 0 && (
        <div className="space-y-0.5">
          {issues.map((issue, index) => (
            <p key={index} className="text-xs text-destructive">
              {issueText(issue)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function HumanWorkspaceAccessDialog({
  open,
  humanName,
  record,
  teamNames,
  defaultTeams,
  canManage,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  humanName: string;
  record: HumanConfigRecord | null;
  teamNames: string[];
  defaultTeams: string[];
  canManage: boolean;
  onOpenChange: (_open: boolean) => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<WorkspaceAccess>(
    () => extractWorkspaceAccess(record) ?? { grants: [], restrictions: [] },
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const grants = draft.grants ?? [];
  const restrictions = draft.restrictions ?? [];
  const issues = validateAccess(draft, teamNames.length > 0 ? teamNames : null);
  const listIssues = (list: 'grants' | 'restrictions') =>
    issues.filter((issue) => issue.list === list && issue.index === -1);

  const setList = (list: 'grants' | 'restrictions', rules: WorkspaceAccessRule[]) => {
    setDirty(true);
    setDraft((prev) => ({ ...prev, [list]: rules }));
  };

  const save = async () => {
    if (!canManage || busy || issues.length > 0) return;
    setBusy(true);
    setError('');
    setWarning('');
    try {
      const result = await agentteamsApi.saveHumanWorkspaceAccess(humanName, draft);
      const submitted = buildWorkspaceAccessPayload(draft);
      if (result.verified || Object.keys(submitted).length === 0) {
        toast.success('工作区访问已保存');
        onSaved();
        onOpenChange(false);
      } else {
        onSaved();
        setWarning('已提交保存，但控制器未回读 workspaceAccess（旧版本不支持或新版本不回显），请核对控制器版本。');
      }
    } catch (err) {
      const prefix = err instanceof ApiError && err.status === 403 ? '403 无权限：' : '保存失败：';
      setError(`${prefix}${formatErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const ruleList = (list: 'grants' | 'restrictions') => {
    const rules = list === 'grants' ? grants : restrictions;
    return (
      <div className="space-y-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xs font-semibold">{list === 'grants' ? '授予规则' : '限制规则'}</span>
          <span className="text-xs text-muted-foreground">
            {list === 'grants'
              ? '为非成员团队加授 files/** 访问'
              : '收窄默认范围（none = 撤销 / read = 降级）'}
          </span>
        </div>
        {rules.length === 0 && (
          <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            未配置（{list === 'grants' ? '继承默认' : '不收窄'}）
          </p>
        )}
        {rules.map((rule, index) => (
          <RuleRow
            key={index}
            rule={rule}
            list={list}
            teamNames={teamNames}
            disabled={!canManage || busy}
            issues={issues.filter((issue) => issue.list === list && issue.index === index)}
            onChange={(next) => setList(list, rules.map((item, i) => (i === index ? next : item)))}
            onRemove={() => setList(list, rules.filter((_, i) => i !== index))}
          />
        ))}
        {listIssues(list).map((issue, index) => (
          <p key={index} className="text-xs text-destructive">
            {issueText(issue)}
          </p>
        ))}
        <Button
          variant="outline"
          className="min-h-11"
          disabled={!canManage || busy || rules.length >= MAX_RULES_PER_LIST}
          onClick={() =>
            setList(list, [
              ...rules,
              { team: '', paths: [], mode: list === 'grants' ? 'read' : 'none' },
            ])
          }
        >
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {list === 'grants' ? '添加授予规则' : '添加限制规则'}
        </Button>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DoorOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            工作区访问 · {humanName}
          </DialogTitle>
          <DialogDescription>
            只修改 spec.workspaceAccess；路径必须在 files/ 下，支持 *（单段）与 **（多段），每规则至多 {MAX_PATHS_PER_RULE} 条。保存后 re-GET 验证。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-3 overflow-y-auto py-1">
          {!canManage && (
            <p role="status" className="rounded-md border border-status-waiting/30 bg-status-waiting/5 p-2 text-xs text-status-waiting">
              只读（403）：需要 L1 管理员权限才能修改工作区访问。
            </p>
          )}
          {error && (
            <p role="alert" className="break-words rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {error}
            </p>
          )}
          {warning && (
            <p role="status" className="break-words rounded-md border border-status-waiting/30 bg-status-waiting/5 p-2 text-xs text-status-waiting">
              {warning}
            </p>
          )}

          <div className="space-y-1.5 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold">默认访问</span>
              <Badge variant="outline" className="text-xs">读写 files/**</Badge>
            </div>
            <div className="flex flex-wrap gap-1">
              {defaultTeams.length > 0 ? (
                defaultTeams.map((name) => (
                  <Badge key={name} variant="secondary" className="text-xs">
                    {name}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  无默认团队（无成员关系且未配置 accessibleTeams）
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              默认访问由成员关系派生，不写字段；限制规则优先于授予规则。
            </p>
          </div>

          {ruleList('grants')}
          {ruleList('restrictions')}
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
            disabled={!canManage || busy || issues.length > 0 || !dirty}
          >
            {busy ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
