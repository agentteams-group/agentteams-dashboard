'use client';

import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge, RuntimeBadge } from '@/components/dashboard/phase-badge';
import { HealthRing } from '@/components/dashboard/health-ring';
import { useAgentHealth } from '@/hooks/use-agent-health';
import { RUNTIME_LABELS } from '@/lib/phase-colors';
import type { WorkerResponse } from '@/lib/agentteams-api';
import { Upload, Check, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useWorkerSkills, useUploadWorkerSkill } from '@/hooks/use-agentteams-worker-skills';
import { PluginDetailBlocks } from '@/components/plugins/plugin-detail-blocks';
import { WorkerCheckpointPanel } from './worker-checkpoint-panel';

const DETAIL_FIELDS: Array<[string, (_w: WorkerResponse) => string]> = [
  ['名称', (w) => w.name],
  ['状态', (w) => w.state],
  ['运行时', (w) => RUNTIME_LABELS[w.runtime] || w.runtime],
  ['模型', (w) => w.model || '-'],
  ['镜像', (w) => w.image || '-'],
  ['团队', (w) => w.team || '-'],
  ['角色', (w) => w.role || '-'],
  ['关联 Agents', (w) => w.agents || '-'],
  ['Matrix 用户', (w) => w.matrixUserID || '-'],
  ['房间 ID', (w) => w.roomID || '-'],
  ['容器管理', (w) => (w.containerManaged ? '是' : '否')],
  ['容器状态', (w) => w.containerState || '-'],
  ['消息', (w) => w.message || '-'],
];

export function WorkerDetailDialog({
  worker,
  onOpenChange,
}: {
  worker: WorkerResponse | null;
  onOpenChange: (_open: boolean) => void;
}) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const { data: currentSkills = [] } = useWorkerSkills(worker?.name ?? null);
  const uploadMutation = useUploadWorkerSkill();

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!worker?.name || !file) return;
    await uploadMutation.mutateAsync({ workerName: worker.name, file });
    setFile(null);
    setUploadOpen(false);
  }, [worker, file, uploadMutation]);

  const uploadResult = uploadMutation.data;
  type UploadStatus = 'success' | 'spec-failed' | 'reload-failed' | null;
  const uploadStatus: UploadStatus = !uploadResult
    ? null
    : !uploadResult.specUpdated
      ? 'spec-failed'
      : uploadResult.reloadError
        ? 'reload-failed'
        : 'success';

  return (
    <>
      <Dialog open={!!worker} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg max-w-[95vw] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Worker 详情 - {worker?.name}</span>
              {worker && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setUploadOpen(true)}
                  className="text-xs"
                >
                  <Upload className="w-3 h-3 mr-1" />
                  上传技能包
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          {worker && (
            <div className="space-y-3 py-4 text-sm">
              <div className="flex items-center gap-2 mb-3">
                <StatusDot phase={worker.phase} />
                <PhaseBadge kind="worker" phase={worker.phase} />
                <RuntimeBadge runtime={worker.runtime} />
              </div>
              <WorkerHealthBreakdown worker={worker} />
              {DETAIL_FIELDS.map(([label, read]) => (
                <div
                  key={label}
                  className="flex justify-between py-1 border-b border-border/50"
                >
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono text-xs max-w-[60%] text-right break-all">
                    {read(worker)}
                  </span>
                </div>
              ))}
              {(worker.mcpServers?.length ?? 0) > 0 && (
                <div className="pt-2">
                  <p className="text-muted-foreground mb-1">MCP Servers</p>
                  {worker.mcpServers?.map((s, i) => (
                    <div key={i} className="text-xs font-mono flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted-foreground">({s.transport})</span>
                      <span className="truncate">{s.url}</span>
                    </div>
                  ))}
                </div>
              )}
              {(worker.exposedPorts?.length ?? 0) > 0 && (
                <div className="pt-2">
                  <p className="text-muted-foreground mb-1">暴露端口</p>
                  {worker.exposedPorts?.map((p, i) => (
                    <div key={i} className="text-xs font-mono">
                      {p.port} → {p.domain}
                    </div>
                  ))}
                </div>
              )}
              {currentSkills.length > 0 && (
                <div className="pt-2">
                  <p className="text-muted-foreground mb-1">已分发技能</p>
                  <div className="flex flex-wrap gap-1">
                    {currentSkills.map((s) => (
                      <Badge key={s} variant="secondary" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Plugin-contributed blocks (extension point: detail-panel) */}
              <PluginDetailBlocks entity="worker" data={worker} />

              {worker?.name ? (
                <WorkerCheckpointPanel workerName={worker.name} />
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Skill Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-md max-w-[95vw]">
          <DialogHeader>
            <DialogTitle>向 {worker?.name} 分发技能包</DialogTitle>
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
              uploadStatus === 'success' ? (
                <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
                  <Check className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">{uploadMutation.data.skillName}</p>
                    <p className="text-xs opacity-80">{uploadMutation.data.description}</p>
                    <p className="text-xs opacity-75 mt-1">{uploadMutation.data.note}</p>
                  </div>
                </div>
              ) : uploadStatus === 'reload-failed' ? (
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
                    <button
                      type="button"
                      className="mt-2 text-xs underline underline-offset-2"
                      onClick={() => uploadMutation.reset()}
                    >
                      重试
                    </button>
                  </div>
                </div>
              )
            )}

            {currentSkills.length > 0 && (
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

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!file || uploadMutation.isPending}
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
    </>
  );
}

function WorkerHealthBreakdown({ worker }: { worker: WorkerResponse }) {
  const health = useAgentHealth(worker);
  if (!health) return null;

  return (
    <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/30 border border-border/50">
      <HealthRing score={health.overall} size={56} strokeWidth={4} label={health.label} />
      <div className="flex-1 space-y-1.5">
        <HealthBar label="可用性" value={health.availability} />
        <HealthBar label="稳定性" value={health.stability} />
        <HealthBar label="就绪度" value={health.readiness} />
      </div>
    </div>
  );
}

function HealthBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? 'bg-emerald-500' : value >= 60 ? 'bg-green-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-10">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-[10px] font-mono w-6 text-right">{value}</span>
    </div>
  );
}
