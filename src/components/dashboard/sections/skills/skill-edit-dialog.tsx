'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUpdateSkill } from '@/hooks/use-skill-center';
import type { SkillEntry } from '@/lib/skill-center-types';

interface SkillEditDialogProps {
  skill: SkillEntry | null;
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onSuccess?: () => void;
}

export function SkillEditDialog({ skill, open, onOpenChange, onSuccess }: SkillEditDialogProps) {
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('');
  const [error, setError] = useState('');

  const updateMutation = useUpdateSkill();

  useEffect(() => {
    if (open && skill) {
      setDescription(skill.description || '');
      setVersion(skill.version || '');
      setError('');
    }
  }, [open, skill]);

  const handleSave = useCallback(async () => {
    if (!skill) return;
    setError('');
    try {
      await updateMutation.mutateAsync({
        name: skill.name,
        data: { description, version: version || undefined },
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败';
      setError(message);
    }
  }, [skill, description, version, updateMutation, onOpenChange, onSuccess]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-w-[95vw] overflow-hidden">
        <DialogHeader>
          <DialogTitle>编辑技能</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-3 overflow-hidden">
          <div className="space-y-2">
            <label className="text-sm font-medium">技能名称</label>
            <Input
              value={skill?.name || ''}
              disabled
              className="bg-muted cursor-not-allowed"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">描述</label>
            <Input
              placeholder="输入技能描述..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">版本</label>
            <Input
              placeholder="例如: 1.0.0"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
