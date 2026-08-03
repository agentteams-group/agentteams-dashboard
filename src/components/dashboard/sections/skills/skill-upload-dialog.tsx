'use client';

import { useState, useCallback } from 'react';
import { Upload, Check, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useCreateSkill } from '@/hooks/use-skill-center';
import type { SkillEntry } from '@/lib/skill-center-types';

interface SkillUploadDialogProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onSuccess?: (_skill: SkillEntry) => void;
  onConflict?: (_skill: SkillEntry) => void;
}

export function SkillUploadDialog({ open, onOpenChange, onSuccess, onConflict }: SkillUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ name: string; description: string } | null>(null);
  const [parsing, setParsing] = useState(false);

  const createMutation = useCreateSkill();

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setPreview(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f) {
        setFile(f);
        setPreview(null);
      }
    },
    [],
  );

  const handleParse = useCallback(async () => {
    if (!file) return;
    setParsing(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { parseSkillPackage } = await import('@/lib/skill-package');
      const parsed = parseSkillPackage(bytes);
      setPreview({ name: parsed.skillName, description: parsed.description });
    } catch {
      // Invalid package, preview will remain null
    } finally {
      setParsing(false);
    }
  }, [file]);

  const handleUpload = useCallback(async () => {
    if (!file) return;
    try {
      const result = await createMutation.mutateAsync(file);
      if (result.conflict) {
        onConflict?.(result as SkillEntry);
      } else {
        onSuccess?.(result);
      }
    } catch {
      // Error handled by mutation
    }
  }, [file, createMutation, onSuccess, onConflict]);

  const handleClose = useCallback(() => {
    setFile(null);
    setPreview(null);
    onOpenChange(false);
  }, [onOpenChange]);

  const isReady = !!file && !!preview && !createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>上传技能包</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">技能包 (ZIP) *</label>
            <div
              className={`relative rounded-md border-2 border-dashed p-6 text-center transition-colors ${
                dragging
                  ? 'border-primary bg-primary/5'
                  : 'border-dashed border-border hover:border-primary/50'
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept=".zip"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={handleFileChange}
              />
              {file ? (
                <div className="flex flex-col items-center gap-2">
                  <Check className="h-6 w-6 text-green-500" />
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={handleParse}
                    disabled={parsing}
                  >
                    {parsing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : '解析预览'}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    拖拽 ZIP 文件到此处，或点击选择
                  </p>
                  <p className="text-xs text-muted-foreground">
                    须包含 SKILL.md（含 name / description 字段）
                  </p>
                </div>
              )}
            </div>
          </div>

          {preview && (
            <div className="space-y-2 p-3 rounded-md bg-muted/50">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">技能名称</Badge>
                <span className="font-mono text-sm">{preview.name}</span>
              </div>
              <div className="flex items-start gap-2">
                <Badge variant="secondary">描述</Badge>
                <span className="text-sm text-muted-foreground">{preview.description}</span>
              </div>
            </div>
          )}

          {createMutation.isError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{createMutation.error?.message ?? '上传失败'}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            取消
          </Button>
          <Button onClick={handleUpload} disabled={!isReady || createMutation.isPending}>
            {createMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                上传中...
              </>
            ) : (
              '上传'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
