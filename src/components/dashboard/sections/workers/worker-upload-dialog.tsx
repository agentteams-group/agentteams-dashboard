'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';

export interface WorkerUploadResult {
  skillName: string;
  description: string;
  filesCount: number;
  note?: string;
}

export function WorkerUploadDialog({
  open,
  onOpenChange,
  isUploading,
  onFileChange,
  result,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  isUploading: boolean;
  onFileChange: (_file: File | null) => void;
  result: WorkerUploadResult | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>上传技能包</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div>
            <Label className="block mb-2">选择文件</Label>
            <Input
              type="file"
              accept=".zip"
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
              disabled={isUploading}
            />
            <p className="text-xs text-muted-foreground mt-1">
              须包含 SKILL.md（含 name / description 字段）
            </p>
          </div>

          {isUploading && (
            <p className="text-sm text-muted-foreground">上传中...</p>
          )}

          {result && (
            <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
              <Check className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">{result.skillName}</p>
                <p className="text-xs opacity-80">{result.description}</p>
                <p className="text-xs opacity-75 mt-1">{result.filesCount} 个文件已上传</p>
                {result.note && <p className="text-xs opacity-75 mt-1">{result.note}</p>}
              </div>
            </div>
          )}

          {!isUploading && !result && (
            <div className="rounded-md border border-dashed border-border p-4 text-center">
              <p className="text-xs text-muted-foreground">
                技能包将直接写入 MinIO 存储，可在「技能」页面查看
              </p>
            </div>
          )}
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
