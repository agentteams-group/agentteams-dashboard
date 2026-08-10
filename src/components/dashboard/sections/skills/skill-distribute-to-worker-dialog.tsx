'use client';

import { useState, useCallback } from 'react';
import { Send, Check, AlertCircle, Loader2 } from 'lucide-react';
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
import { useWorkerSkills } from '@/hooks/use-agentteams-worker-skills';
import { agentteamsApi } from '@/lib/agentteams-api';

type DistributeStep = 'idle' | 'downloading' | 'uploading' | 'done';

export function SkillDistributeToWorkerDialog({
  skillName,
  open,
  onOpenChange,
}: {
  skillName: string;
  open: boolean;
  onOpenChange: (_open: boolean) => void;
}) {
  const [selectedWorker, setSelectedWorker] = useState('');
  const [step, setStep] = useState<DistributeStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [resultNote, setResultNote] = useState<string | null>(null);

  const { data: workers = [] } = useWorkers();
  const { data: existingSkills = [] } = useWorkerSkills(selectedWorker || null);

  const handleClose = useCallback(() => {
    setSelectedWorker('');
    setStep('idle');
    setError(null);
    setResultNote(null);
    onOpenChange(false);
  }, [onOpenChange]);

  const handleDistribute = useCallback(async () => {
    if (!selectedWorker) return;

    setError(null);
    setResultNote(null);

    // Step 1: Download skill
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

    // Step 2: Upload to worker
    setStep('uploading');
    try {
      // Look up the worker's runtime so the server can write the skill
      // files to the correct on-disk path. Different runtimes read from
      // different workspace roots (QwenPaw uses .qwenpaw/workspaces/default/,
      // Copaw uses .copaw/workspaces/default/, others use the canonical
      // skills/ directory).
      const targetWorker = workers.find((w) => w.name === selectedWorker);
      const res = await agentteamsApi.uploadWorkerSkill(
        selectedWorker,
        file,
        targetWorker?.runtime,
      );
      // The server already restarted the worker (sleep → wake) after
      // storing the skill files. Use the server's note as-is.
      setResultNote(res.note ?? '已通知 Worker 加载新技能');

      // Update the worker's spec.skills so the Controller-managed
      // resource stays in sync with the files on disk.
      try {
        const existingSkills = targetWorker?.skills ?? [];
        const skillNameFromPackage = res.skillName;
        if (!existingSkills.includes(skillNameFromPackage)) {
          await agentteamsApi.updateWorker(selectedWorker, {
            skills: [...existingSkills, skillNameFromPackage],
          });
        }
      } catch {
        // Updating spec.skills is best-effort; the files are already in place.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传技能到 Worker 失败');
      setStep('idle');
      return;
    }

    setStep('done');
  }, [selectedWorker, skillName, workers]);

  const isReady = !!selectedWorker && step === 'idle';
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
          {/* Skill name display */}
          <div className="p-3 rounded-md bg-muted/50 border">
            <p className="text-xs text-muted-foreground">技能</p>
            <p className="font-mono font-medium">{skillName}</p>
          </div>

          {/* Worker selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">目标 Worker *</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedWorker}
              onChange={(e) => setSelectedWorker(e.target.value)}
              disabled={isRunning}
            >
              <option value="">-- 选择 Worker --</option>
              {workers.map((w) => (
                <option key={w.name} value={w.name}>
                  {w.name} ({w.runtime})
                </option>
              ))}
            </select>
          </div>

          {/* Progress steps */}
          {isRunning && (
            <div className="space-y-2 p-3 rounded-md border bg-muted/30">
              <StepItem
                label="下载技能包"
                step={step}
                active="downloading"
              />
              <StepItem
                label="上传到 Worker"
                step={step}
                active="uploading"
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

          {/* Success display */}
          {step === 'done' && (
            <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
              <Check className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">分发成功</p>
                <p className="text-xs opacity-80 mt-1">
                  技能 "{skillName}" 已分发到 Worker "{selectedWorker}"
                </p>
                {resultNote && (
                  <p className="text-xs opacity-75 mt-0.5">{resultNote}</p>
                )}
              </div>
            </div>
          )}

          {/* Existing skills on worker */}
          {selectedWorker && existingSkills.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">该 Worker 已有技能</p>
              <div className="flex flex-wrap gap-1">
                {existingSkills.map((s) => (
                  <Badge
                    key={s}
                    variant={s === skillName ? 'default' : 'secondary'}
                    className="text-xs"
                  >
                    {s}
                  </Badge>
                ))}
              </div>
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
              disabled={!isReady}
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {step === 'downloading' ? '下载中...' : '上传中...'}
                </>
              ) : (
                '分发技能'
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepItem({ label, step, active }: { label: string; step: DistributeStep; active: DistributeStep }) {
  const doneSteps: DistributeStep[] = ['downloading', 'uploading', 'done'];
  const activeIdx = doneSteps.indexOf(active);
  const stepIdx = doneSteps.indexOf(step);

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
