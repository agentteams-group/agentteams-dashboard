'use client';

// Manager Skills 弹窗：tags 自由输入 + 技能中心目录快捷添加。
// 保存语义 = 整表替换（PUT /managers {skills}，非 nil 即整表覆盖）。

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
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

/** 归一化：按逗号/空格拆、去空、保序去重。 */
export function normalizeSkillTags(raw: string[]): string[] {
  const out: string[] = [];
  for (const entry of raw) {
    for (const part of entry.split(/[,，\s]+/)) {
      const name = part.trim();
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

export function ManagerSkillsDialog({
  open,
  managerName,
  value,
  suggestions,
  saving,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  managerName: string;
  value: string[];
  /** 技能中心目录（快捷添加；不在目录里的存量条目照常保留）。 */
  suggestions?: string[];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (_skills: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[]>(value);
  const [input, setInput] = useState('');
  const [initMarker, setInitMarker] = useState(`${managerName}\u0000${value.join('\u0001')}`);
  const [wasOpen, setWasOpen] = useState(open);
  const marker = `${managerName}\u0000${value.join('\u0001')}`;
  if (initMarker !== marker) {
    setInitMarker(marker);
    setDraft(value);
  }
  // 每次打开都从当前 spec 重新起稿（取消后重开不留上次未保存的改动）。
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDraft(value);
      setInput('');
    }
  }

  const add = (raw: string) => {
    const next = normalizeSkillTags([...draft, raw]);
    setDraft(next);
    setInput('');
  };

  const catalogOnly = (suggestions ?? []).filter((name) => !draft.includes(name));
  const changed = normalizeSkillTags(draft).join('\u0001') !== normalizeSkillTags(value).join('\u0001');

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-[95vw] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Skills 配置 - {managerName}</DialogTitle>
          <DialogDescription>
            保存为整表替换（清空全部 = 提交空表）。不在技能中心目录里的存量条目会原样保留。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (input.trim()) add(input);
            }}
          >
            <Input
              aria-label="添加技能名"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="输入技能名后回车（如 nacos://team/skills 或本地技能名）"
            />
            <Button type="submit" variant="outline" disabled={!input.trim()}>
              <Plus className="mr-1 size-3.5" aria-hidden="true" />
              添加
            </Button>
          </form>

          <div className="flex min-h-8 flex-wrap gap-1.5">
            {draft.length === 0 ? (
              <span className="text-xs text-muted-foreground">暂未配置技能</span>
            ) : (
              draft.map((skill) => (
                <Badge key={skill} variant="secondary" className="gap-1 pr-1">
                  {skill}
                  <button
                    type="button"
                    aria-label={`移除技能 ${skill}`}
                    className="rounded-full p-0.5 hover:bg-muted"
                    onClick={() => setDraft((rows) => rows.filter((row) => row !== skill))}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </Badge>
              ))
            )}
          </div>

          {catalogOnly.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">技能中心目录（点击添加）</p>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {catalogOnly.slice(0, 100).map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => add(name)}
                    className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted"
                  >
                    + {name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button disabled={saving} onClick={() => onSubmit(normalizeSkillTags(draft))}>
            {saving ? '保存中…' : changed ? '保存' : '保存（无改动）'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
