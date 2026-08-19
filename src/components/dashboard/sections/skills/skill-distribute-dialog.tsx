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
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useWorkerSkills, useUploadWorkerSkill } from '@/hooks/use-agentteams-worker-skills';

export function SkillDistributeDialog({
  dialogOpen,
  onOpenChange,
}: {
  dialogOpen: boolean;
  onOpenChange: (_open: boolean) => void;
}) {
  const [selectedWorker, setSelectedWorker] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const { data: workers = [] } = useWorkers();
  const { data: currentSkills = [] } = useWorkerSkills(selectedWorker);
  const uploadMutation = useUploadWorkerSkill();

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f) setFile(f);
    },
    [],
  );

  const handleUpload = useCallback(async () => {
    if (!selectedWorker || !file) return;
    await uploadMutation.mutateAsync({ workerName: selectedWorker, file });
  }, [selectedWorker, file, uploadMutation]);

  const handleClose = useCallback(() => {
    setSelectedWorker('');
    setFile(null);
    onOpenChange(false);
  }, [onOpenChange]);

  const isReady = !!selectedWorker && !!file && !uploadMutation.isPending;

  return (
    <Dialog open={dialogOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>向 Worker 分发技能包</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">选择 Worker *</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedWorker}
              onChange={(e) => setSelectedWorker(e.target.value)}
            >
              <option value="">-- 选择 Worker --</option>
              {workers.map((w) => (
                <option key={w.name} value={w.name}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

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

          {uploadMutation.isError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{uploadMutation.error?.message ?? '上传失败'}</p>
            </div>
          )}

          {uploadMutation.isSuccess && uploadMutation.data && (
            uploadMutation.data.specUpdated && !uploadMutation.data.reloadError ? (
              <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
                <Check className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">{uploadMutation.data.skillName}</p>
                  <p className="text-xs opacity-80">{uploadMutation.data.description}</p>
                  <p className="text-xs opacity-75 mt-1">{uploadMutation.data.note}</p>
                </div>
              </div>
            ) : uploadMutation.data.specUpdated ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">技能已就位，但 Worker 重启未确认</p>
                  <p className="text-xs opacity-80">
                    {uploadMutation.data.skillName} · 文件与 spec.skills 已写入
                  </p>
                  <p className="text-xs opacity-75 mt-1">
                    {uploadMutation.data.reloadError ?? '稍后会自动 reload，或手动触发 ensure-ready。'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">技能文件已上传，但声明式分配更新失败</p>
                  <p className="text-xs opacity-80">
                    {uploadMutation.data.skillName} ·{' '}
                    {uploadMutation.data.filesCount} 个文件
                  </p>
                  <p className="text-xs opacity-75 mt-1">
                    {uploadMutation.data.specError ?? '请稍后重试，或手动刷新 Worker 详情。'}
                  </p>
                </div>
              </div>
            )
          )}

          {selectedWorker && currentSkills !== undefined && currentSkills.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">该 Worker 已有技能</p>
              <div className="flex flex-wrap gap-1">
                {currentSkills.map((s) => (
                  <Badge key={s} variant="secondary" className="text-xs">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            取消
          </Button>
          <Button onClick={handleUpload} disabled={!isReady || uploadMutation.isPending}>
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                上传中...
              </>
            ) : (
              '分发技能'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
