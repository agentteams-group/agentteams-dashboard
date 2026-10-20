'use client';

import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { HumanResponse, UpdateHumanRequest } from '@/lib/agentteams-api';
import { PERMISSION_LABELS, PERMISSION_LEVELS } from './human-types';
import { MemberPicker } from '../shared/member-picker';
import { InfoTip } from '@/components/dashboard/info-tip';

export function parseNameList(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface HumanEditDraft {
  displayName: string;
  email: string;
  permissionLevel: 1 | 2 | 3;
  accessibleTeams: string;
  accessibleWorkers: string;
  note: string;
}

function toDraft(human: HumanResponse | null): HumanEditDraft {
  return {
    displayName: human?.displayName ?? '',
    email: human?.email ?? '',
    // 无级别时默认 2（团队成员）——与 controller/插件默认一致（不是 1：
    // 1 = 管理员，默认给最高权限是错的）。
    permissionLevel: (human?.permissionLevel ?? 2) as 1 | 2 | 3,
    accessibleTeams: (human?.accessibleTeams ?? []).join(', '),
    accessibleWorkers: (human?.accessibleWorkers ?? []).join(', '),
    note: human?.note ?? '',
  };
}

/**
 * #1209 PUT /humans/{name} is merge-patch semantics: absent key = unchanged,
 * present key = replace, explicit empty list = clear. This builds the minimal
 * diff so an untouched field is never re-sent (and a cleared list is sent as
 * `[]` rather than omitted, which would leave it unchanged).
 */
export function buildHumanUpdatePayload(
  human: HumanResponse,
  draft: HumanEditDraft,
): UpdateHumanRequest {
  const payload: UpdateHumanRequest = {};
  if (draft.displayName !== (human.displayName ?? '')) {
    payload.displayName = draft.displayName;
  }
  if (draft.email !== (human.email ?? '')) {
    payload.email = draft.email;
  }
  if (draft.permissionLevel !== (human.permissionLevel ?? 2)) {
    payload.permissionLevel = draft.permissionLevel;
  }
  if (parseNameList(draft.accessibleTeams).join('|') !== (human.accessibleTeams ?? []).join('|')) {
    payload.accessibleTeams = parseNameList(draft.accessibleTeams);
  }
  if (
    parseNameList(draft.accessibleWorkers).join('|') !== (human.accessibleWorkers ?? []).join('|')
  ) {
    payload.accessibleWorkers = parseNameList(draft.accessibleWorkers);
  }
  if (draft.note !== (human.note ?? '')) {
    payload.note = draft.note;
  }
  return payload;
}

export function HumanEditDialog({
  human,
  teams,
  workers,
  isPending,
  onOpenChange,
  onSubmit,
}: {
  human: HumanResponse | null;
  teams: string[];
  workers: string[];
  isPending: boolean;
  onOpenChange: (_open: boolean) => void;
  onSubmit: (_payload: UpdateHumanRequest) => void;
}) {
  // Re-sync the draft whenever the target human changes (dialog open/close).
  const [lastHuman, setLastHuman] = useState<HumanResponse | null>(human);
  const [draft, setDraft] = useState<HumanEditDraft>(() => toDraft(human));
  if (human !== lastHuman) {
    setLastHuman(human);
    setDraft(toDraft(human));
  }

  // Client-side pre-flight for the server's dangling-reference rejection
  // (#1209: missing team/worker → 400 named) — surface it before submit.
  const missingTeams = parseNameList(draft.accessibleTeams).filter((t) => !teams.includes(t));
  const missingWorkers = parseNameList(draft.accessibleWorkers).filter((w) => !workers.includes(w));
  const payload = human ? buildHumanUpdatePayload(human, draft) : {};
  const hasChanges = Object.keys(payload).length > 0;

  return (
    <Dialog open={!!human} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑 Human - {human?.name}</DialogTitle>
        </DialogHeader>
        {human && (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>显示名称</Label>
              <Input
                value={draft.displayName}
                onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                placeholder="用户显示名称"
              />
            </div>
            <div className="space-y-2">
              <Label>邮箱</Label>
              <Input
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="user@example.com"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Label>权限等级</Label>
                <InfoTip label="权限等级说明">
                  L1 = 管理员（Controller 管理员 token；Matrix 登录获得 L2）
                </InfoTip>
              </div>
              <Select
                value={String(draft.permissionLevel)}
                onValueChange={(v) => setDraft({ ...draft, permissionLevel: Number(v) as 1 | 2 | 3 })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERMISSION_LEVELS.map((lvl) => (
                    <SelectItem key={lvl} value={String(lvl)}>
                      {lvl} - {PERMISSION_LABELS[lvl]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>可访问团队（留空 = 清空）</Label>
              <MemberPicker
                options={teams.map((team) => ({ value: team, label: team }))}
                selected={parseNameList(draft.accessibleTeams)}
                onAdd={(team) =>
                  setDraft({
                    ...draft,
                    accessibleTeams: [...parseNameList(draft.accessibleTeams), team].join(', '),
                  })
                }
                onRemove={(team) =>
                  setDraft({
                    ...draft,
                    accessibleTeams: parseNameList(draft.accessibleTeams)
                      .filter((name) => name !== team)
                      .join(', '),
                  })
                }
                placeholder="选择团队添加…"
              />
              {missingTeams.length > 0 && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  以下团队不存在：{missingTeams.join('、')}（服务端拒绝悬空引用，请核对后再保存）
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>可访问 Workers（留空 = 清空）</Label>
              <MemberPicker
                options={workers.map((worker) => ({ value: worker, label: worker }))}
                selected={parseNameList(draft.accessibleWorkers)}
                onAdd={(worker) =>
                  setDraft({
                    ...draft,
                    accessibleWorkers: [...parseNameList(draft.accessibleWorkers), worker].join(
                      ', ',
                    ),
                  })
                }
                onRemove={(worker) =>
                  setDraft({
                    ...draft,
                    accessibleWorkers: parseNameList(draft.accessibleWorkers)
                      .filter((name) => name !== worker)
                      .join(', '),
                  })
                }
                placeholder="选择 Worker 添加…"
              />
              {missingWorkers.length > 0 && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  以下 Workers 不存在：{missingWorkers.join('、')}（服务端拒绝悬空引用，请核对后再保存）
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>备注</Label>
              <Textarea
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="备注（可选）"
                rows={2}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={() => onSubmit(payload)}
            disabled={
              !hasChanges || missingTeams.length > 0 || missingWorkers.length > 0 || isPending
            }
            className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600"
          >
            {isPending ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
