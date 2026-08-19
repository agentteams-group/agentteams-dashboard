'use client';

import { useState, useCallback } from 'react';
import { Send, Check, AlertCircle, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { agentteamsApi } from '@/lib/agentteams-api';

type WorkerStatus =
  | 'pending'
  | 'uploading'
  | 'uploading-done'
  | 'spec-failed'
  | 'restarting'
  | 'done'
  | 'failed';

interface WorkerDistributeState {
  name: string;
  status: WorkerStatus;
  note?: string;
}

export function SkillDistributeToWorkerDialog({
  skillName,
  open,
  onOpenChange,
}: {
  skillName: string;
  open: boolean;
  onOpenChange: (_open: boolean) => void;
}) {
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
  const [step, setStep] = useState<'idle' | 'downloading' | 'uploading' | 'restarting' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [workerStates, setWorkerStates] = useState<WorkerDistributeState[]>([]);

  const { data: workers = [] } = useWorkers();

  const handleClose = useCallback(() => {
    setSelectedWorkers([]);
    setStep('idle');
    setError(null);
    setWorkerStates([]);
    onOpenChange(false);
  }, [onOpenChange]);

  const toggleWorker = useCallback((workerName: string) => {
    setSelectedWorkers((prev) =>
      prev.includes(workerName)
        ? prev.filter((w) => w !== workerName)
        : [...prev, workerName]
    );
  }, []);

  /**
   * Read the worker's current `spec.skills` straight from the controller so
   * we never lose a concurrent insert made by another Dashboard session. The
   * page-level `useWorkers()` snapshot can be minutes stale and using it
   * here would clobber skills added by another tab.
   */
  const fetchLatestSpecSkills = useCallback(
    async (workerName: string): Promise<string[]> => {
      const latest = await agentteamsApi.getWorker(workerName);
      return Array.isArray(latest.skills) ? latest.skills : [];
    },
    [],
  );

  const handleDistribute = useCallback(async () => {
    if (!selectedWorkers.length) return;

    setError(null);

    setStep('downloading');
    let file: File;
    try {
      try {
        file = await agentteamsApi.downloadSkill(skillName);
      } catch {
        file = await agentteamsApi.downloadNacosSkill(skillName);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载技能失败');
      setStep('idle');
      return;
    }

    setStep('uploading');
    const initialStates: WorkerDistributeState[] = selectedWorkers.map((name) => ({
      name,
      status: 'pending',
    }));
    setWorkerStates([...initialStates]);

    type PerWorkerResult = {
      uploaded: boolean;
      uploadedSkillName: string | null;
      fileNote: string;
      specUpdated: boolean;
      specError?: string;
    };

    const perWorker: Record<string, PerWorkerResult> = {};
    for (const workerName of selectedWorkers) {
      const targetWorker = workers.find((w) => w.name === workerName);
      perWorker[workerName] = {
        uploaded: false,
        uploadedSkillName: null,
        fileNote: '',
        specUpdated: false,
      };

      setWorkerStates((prev) =>
        prev.map((s) => (s.name === workerName ? { ...s, status: 'uploading' as WorkerStatus } : s)),
      );

      let uploadError: string | null = null;
      let resolvedName: string | null = null;
      let fileNote = '';
      try {
        const res = await agentteamsApi.uploadWorkerSkill(
          workerName,
          file,
          targetWorker?.runtime,
          { restart: false },
        );
        resolvedName = res.skillName;
        fileNote = res.note ?? '上传成功';
        perWorker[workerName].uploaded = true;
        perWorker[workerName].uploadedSkillName = resolvedName;
        perWorker[workerName].fileNote = fileNote;
      } catch (err) {
        uploadError = err instanceof Error ? err.message : '上传失败';
      }

      // Files are on disk; now extend `spec.skills` idempotently. We must
      // not report "all good" if the controller declined the spec update —
      // the Worker reconciler and AT controller rely on spec.skills matching
      // the on-disk prefix. Re-read the worker's spec before merging so a
      // concurrent dashboard session cannot have its new skills clobbered.
      if (perWorker[workerName].uploaded && resolvedName) {
        try {
          const currentSkills = await fetchLatestSpecSkills(workerName);
          if (currentSkills.includes(resolvedName)) {
            perWorker[workerName].specUpdated = true;
            setWorkerStates((prev) =>
              prev.map((s) =>
                s.name === workerName
                  ? { ...s, status: 'uploading-done' as WorkerStatus, note: fileNote }
                  : s,
              ),
            );
          } else {
            const merged = [...currentSkills, resolvedName];
            await agentteamsApi.updateWorker(workerName, { skills: merged });
            perWorker[workerName].specUpdated = true;
            setWorkerStates((prev) =>
              prev.map((s) =>
                s.name === workerName
                  ? { ...s, status: 'uploading-done' as WorkerStatus, note: fileNote }
                  : s,
              ),
            );
          }
        } catch (specErr) {
          perWorker[workerName].specError =
            specErr instanceof Error ? specErr.message : 'spec.skills 更新失败';
          setWorkerStates((prev) =>
            prev.map((s) =>
              s.name === workerName
                ? {
                    ...s,
                    status: 'spec-failed' as WorkerStatus,
                    note: `文件已上传，但 spec.skills 更新失败: ${perWorker[workerName].specError}`,
                  }
                : s,
            ),
          );
          // Continue to the next worker — this one is in a partial state but
          // we must not let it block other workers.
          continue;
        }
      } else if (uploadError) {
        setWorkerStates((prev) =>
          prev.map((s) =>
            s.name === workerName
              ? { ...s, status: 'failed' as WorkerStatus, note: uploadError ?? '上传失败' }
              : s,
          ),
        );
        continue;
      }
    }

    // Restart only workers whose files AND spec.skills are in place. Workers
    // in spec-failed state still have their files on disk, but skipping the
    // restart avoids the controller bouncing them into a state where the
    // on-disk prefix and the spec diverge further.
    setStep('restarting');
    const restartable: string[] = [];
    for (const workerName of selectedWorkers) {
      const r = perWorker[workerName];
      if (r.uploaded && r.specUpdated) restartable.push(workerName);
    }
    for (const workerName of restartable) {
      setWorkerStates((prev) =>
        prev.map((s) =>
          s.name === workerName
            ? { ...s, status: 'restarting' as WorkerStatus, note: '重启中...' }
            : s,
        ),
      );
      try {
        const restartRes = await agentteamsApi.restartWorker(workerName);
        setWorkerStates((prev) =>
          prev.map((s) =>
            s.name === workerName
              ? {
                  ...s,
                  status: 'done' as WorkerStatus,
                  note: restartRes.note || '已重启',
                }
              : s,
          ),
        );
      } catch (err) {
        setWorkerStates((prev) =>
          prev.map((s) =>
            s.name === workerName
              ? {
                  ...s,
                  status: 'failed' as WorkerStatus,
                  note: `文件与 spec.skills 已就绪，但重启失败: ${err instanceof Error ? err.message : 'unknown'}`,
                }
              : s,
          ),
        );
      }
    }

    setStep('done');
  }, [selectedWorkers, skillName, workers, fetchLatestSpecSkills]);


  const isRunning = step !== 'idle' && step !== 'done';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md max-w-[95vw]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            分发技能到 Worker
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="p-3 rounded-md bg-muted/50 border">
            <p className="text-xs text-muted-foreground">技能</p>
            <p className="font-mono font-medium">{skillName}</p>
          </div>

          {/* Multi-worker selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              目标 Worker * ({selectedWorkers.length} 个已选)
            </label>
                {isRunning ? (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {workerStates.map((ws) => (
                  <div key={ws.name} className="flex items-center justify-between px-3 py-1.5 rounded border text-sm">
                    <span className="font-mono">{ws.name}</span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${workerStateClass(ws.status)}`}
                    >
                      {workerStateLabel(ws.status)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                {workers.length === 0 && (
                  <p className="p-3 text-sm text-muted-foreground">暂无可用的 Worker</p>
                )}
                {workers.map((w) => {
                  const selected = selectedWorkers.includes(w.name);
                  return (
                    <button
                      key={w.name}
                      type="button"
                      className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-muted/50 transition-colors ${selected ? 'bg-primary/5' : ''}`}
                      onClick={() => toggleWorker(w.name)}
                    >
                      <div>
                        <span className="font-mono">{w.name}</span>
                        <span className="text-muted-foreground ml-2 text-xs">({w.runtime})</span>
                      </div>
                      {selected && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Progress steps */}
          {isRunning && (
            <div className="space-y-2 p-3 rounded-md border bg-muted/30">
              <StepItem
                label="下载技能包"
                activeStep={step}
                stepKey="downloading"
              />
              <StepItem
                label={`上传到 ${selectedWorkers.length} 个 Worker`}
                activeStep={step}
                stepKey="uploading"
              />
              <StepItem
                label="重启 Worker"
                activeStep={step}
                stepKey="restarting"
              />
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          {/* Done summary */}
          {step === 'done' && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
                <Check className="h-4 w-4 shrink-0 mt-0.5" />
                <p>
                  技能 "{skillName}" 已分发到 {workerStates.filter((s) => s.status === 'done').length} 个 Worker
                  {workerStates.filter((s) => s.status === 'failed').length > 0 &&
                    `，${workerStates.filter((s) => s.status === 'failed').length} 个失败`}
                  {workerStates.filter((s) => s.status === 'spec-failed').length > 0 &&
                    `，${workerStates.filter((s) => s.status === 'spec-failed').length} 个部分失败`}
                </p>
              </div>
              {(workerStates.some((s) => s.status === 'failed') || workerStates.some((s) => s.status === 'spec-failed')) && (
                <div className="space-y-1">
                  {[...workerStates.filter((s) => s.status === 'spec-failed'), ...workerStates.filter((s) => s.status === 'failed')].map((s) => (
                    <div
                      key={s.name}
                      className={`flex items-center gap-2 px-3 py-1 rounded border text-sm ${
                        s.status === 'spec-failed'
                          ? 'border-amber-200 text-amber-700 bg-amber-50 dark:bg-amber-950'
                          : 'border-red-200 text-red-600'
                      }`}
                    >
                      <X className="h-3 w-3" />
                      <span className="font-mono">{s.name}</span>
                      <span className="text-xs opacity-75">{s.note}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {step === 'done' ? '关闭' : '取消'}
          </Button>
          {step === 'done' ? (
            <Button onClick={handleClose}>完成</Button>
          ) : (
            <Button
              onClick={handleDistribute}
              disabled={selectedWorkers.length === 0 || isRunning}
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {step === 'downloading' ? '下载中...' : step === 'uploading' ? '上传中...' : '重启中...'}
                </>
              ) : (
                `分发到 ${selectedWorkers.length || ''} 个 Worker`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type DistributeStep = 'idle' | 'downloading' | 'uploading' | 'restarting' | 'done';

function workerStateLabel(status: WorkerStatus): string {
  switch (status) {
    case 'uploading':
      return '上传中';
    case 'uploading-done':
      return '已上传';
    case 'restarting':
      return '重启中';
    case 'done':
      return '完成';
    case 'spec-failed':
      return '部分失败';
    case 'failed':
      return '失败';
    case 'pending':
    default:
      return '等待';
  }
}

function workerStateClass(status: WorkerStatus): string {
  switch (status) {
    case 'done':
    case 'uploading-done':
      return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
    case 'spec-failed':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300';
    case 'failed':
      return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
    case 'uploading':
    case 'restarting':
    case 'pending':
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function StepItem({
  label,
  activeStep,
  stepKey,
}: {
  label: string;
  activeStep: DistributeStep;
  stepKey: DistributeStep;
}) {
  const order: DistributeStep[] = ['downloading', 'uploading', 'restarting', 'done'];
  const activeIdx = order.indexOf(activeStep);
  const stepIdx = order.indexOf(stepKey);

  let state: 'pending' | 'running' | 'done';
  if (stepIdx < activeIdx) state = 'done';
  else if (stepIdx === activeIdx) state = 'running';
  else state = 'pending';

  return (
    <div className="flex items-center gap-2 text-sm">
      {state === 'running' ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      ) : state === 'done' ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
      )}
      <span className={state === 'pending' ? 'text-muted-foreground' : state === 'running' ? 'font-medium' : ''}>
        {label}
      </span>
    </div>
  );
}
