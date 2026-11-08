'use client';

import { useCallback, useState } from 'react';
import { AlertCircle, Check, Loader2, Upload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useUploadWorkerSkill } from '@/hooks/use-agentteams-worker-skills';

/** 技能包分发弹窗（从旧的详情弹窗抽出，现只在抽屉「技能」卡里打开）。 */
export function WorkerSkillUploadDialog({
  open,
  workerName,
  existingSkills,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  workerName: string;
  existingSkills: string[];
  onOpenChange: (_open: boolean) => void;
  onUploaded?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const uploadMutation = useUploadWorkerSkill();

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0];
    if (next) setFile(next);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const next = event.dataTransfer.files?.[0];
    if (next) setFile(next);
  }, []);

  const result = uploadMutation.data;
  const status = !result
    ? null
    : !result.specUpdated
      ? 'spec-failed'
      : result.reloadError
        ? 'reload-failed'
        : 'success';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setFile(null);
          uploadMutation.reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>向 {workerName} 分发技能包</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">技能包 (ZIP) *</label>
            <div
              className={`relative rounded-md border-2 border-dashed p-6 text-center transition-colors ${
                dragging
                  ? 'border-primary bg-primary/5'
                  : 'border-dashed border-border hover:border-primary/50'
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept=".zip"
                aria-label="技能包 ZIP"
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
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">拖拽 ZIP 文件到此处，或点击选择</p>
                  <p className="text-xs text-muted-foreground">须包含 SKILL.md（含 name / description 字段）</p>
                </div>
              )}
            </div>
          </div>

          {uploadMutation.isError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{uploadMutation.error?.message ?? '上传失败'}</p>
            </div>
          )}

          {result && status === 'success' && (
            <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
              <Check className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">{result.skillName}</p>
                <p className="text-xs opacity-80">{result.description}</p>
                <p className="text-xs opacity-75 mt-1">{result.note}</p>
              </div>
            </div>
          )}

          {result && status === 'reload-failed' && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">技能已就位，但 Worker 重启未确认</p>
                <p className="text-xs opacity-80">{result.skillName} · 文件与 spec.skills 已写入</p>
                <p className="text-xs opacity-75 mt-1">
                  {result.reloadError ?? '稍后会自动 reload，或手动触发 ensure-ready。'}
                </p>
              </div>
            </div>
          )}

          {result && status === 'spec-failed' && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">技能文件已上传，但声明式分配更新失败</p>
                <p className="text-xs opacity-80">{result.skillName} · {result.filesCount} 个文件</p>
                <p className="text-xs opacity-75 mt-1">
                  {result.specError ?? '请稍后重试，或手动刷新 Worker 详情。'}
                </p>
              </div>
            </div>
          )}

          {existingSkills.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">该 Worker 已有技能</p>
              <div className="flex flex-wrap gap-1">
                {existingSkills.map((skill) => (
                  <Badge key={skill} variant="secondary" className="text-xs">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!file || uploadMutation.isPending}
            onClick={async () => {
              if (!file) return;
              try {
                await uploadMutation.mutateAsync({ workerName, file });
                setFile(null);
                onUploaded?.();
              } catch {
                // 错误横幅由 uploadMutation.isError 渲染
              }
            }}
          >
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                上传中...
              </>
            ) : (
              '分发技能'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
