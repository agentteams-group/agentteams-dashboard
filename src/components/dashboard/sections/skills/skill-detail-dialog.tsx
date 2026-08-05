'use client';

import { Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { SkillEntry } from '@/lib/skill-center-types';

interface SkillDetailDialogProps {
  skill: SkillEntry | null;
  open: boolean;
  onOpenChange: (_open: boolean) => void;
}

export function SkillDetailDialog({ skill, open, onOpenChange }: SkillDetailDialogProps) {
  if (!skill) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle className="font-mono">{skill.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-4">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">描述</span>
            <p className="text-sm">{skill.description || '无'}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs font-medium text-muted-foreground">来源</span>
              <p>{skill.source === 'nacos' ? `Nacos (${skill.sourceAlias || '—'})` : skill.source === 'builtin' ? '内置' : '自定义'}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">版本</span>
              <p>{skill.version || '—'}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">文件数</span>
              <p>{skill.fileCount}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">创建时间</span>
              <p>{new Date(skill.createdAt).toLocaleString('zh-CN')}</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
