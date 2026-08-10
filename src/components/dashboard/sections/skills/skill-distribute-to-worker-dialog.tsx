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

type WorkerStatus = 'pending' | 'uploading' | 'done' | 'failed';

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

  const handleDistribute = useCallback(async () => {
    if (!selectedWorkers.length) return;

    setError(null);

    // Step 1: Download skill once
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

    // Step 2: Upload to all workers without restarting
    setStep('uploading');
    const states: WorkerDistributeState[] = selectedWorkers.map((name) => ({
      name,
      status: 'pending',
    }));
    setWorkerStates([...states]);

    for (let i = 0; i < selectedWorkers.length; i++) {
      const workerName = selectedWorkers[i];
      const targetWorker = workers.find((w) => w.name === workerName);

      setWorkerStates((prev) =>
        prev.map((s) => (s.name === workerName ? { ...s, status: 'uploading' as WorkerStatus } : s))
      );

      try {
        const res = await agentteamsApi.uploadWorkerSkill(
          workerName,
          file,
          targetWorker?.runtime,
          { restart: false },
        );

        // Update spec.skills
        try {
          const existingSkills = targetWorker?.skills ?? [];
          const resolvedName = res.skillName;
          if (!existingSkills.includes(resolvedName)) {
            await agentteamsApi.updateWorker(workerName, {
              skills: [...existingSkills, resolvedName],
            });
          }
        } catch {
          // best-effort
        }

        setWorkerStates((prev) =>
          prev.map((s) =>
            s.name === workerName ? { ...s, status: 'done' as WorkerStatus, note: res.note } : s
          )
        );
      } catch (err) {
        setWorkerStates((prev) =>
          prev.map((s) =>
            s.name === workerName
              ? { ...s, status: 'failed' as WorkerStatus, note: err instanceof Error ? err.message : '上传失败' }
              : s
          )
        );
      }
    }

    // Step 3: Restart all workers that succeeded
    setStep('restarting');
    for (const s of states) {
      if (s.status !== 'done') continue;
      try {
        await agentteamsApi.restartWorker(s.name);
      } catch {
        // restart failed but files are in place
      }
    }

    setStep('done');
  }, [selectedWorkers, skillName, workers]);

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
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        ws.status === 'uploading' ? 'bg-muted text-muted-foreground' :
                        ws.status === 'done' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                        ws.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                        'bg-muted text-muted-foreground'
                      }`}
                    >
                      {ws.status === 'uploading' ? '上传中' : ws.status === 'done' ? '完成' : ws.status === 'failed' ? '失败' : '等待'}
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
                </p>
              </div>
              {workerStates.some((s) => s.status === 'failed') && (
                <div className="space-y-1">
                  {workerStates.filter((s) => s.status === 'failed').map((s) => (
                    <div key={s.name} className="flex items-center gap-2 px-3 py-1 rounded border border-red-200 text-sm text-red-600">
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
