'use client';

import { useRef, useState } from 'react';
import { Check, Loader2, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DEVELOPMENT_ROLES, developmentSquadNameError, deployDevelopmentSquad, type SquadDeploymentResult, type SquadDeploymentStep } from '@/lib/development-squad';

const STEPS: { id: SquadDeploymentStep; label: string }[] = [
  { id: 'assets', label: '同步资产' }, { id: 'agents', label: '关联 Agent' },
  { id: 'team', label: '建立小队' }, { id: 'starting', label: '启动 Agent' },
];

export function DevelopmentSquadDialog({ open, onOpenChange, onDeployed }: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onDeployed: (_result: SquadDeploymentResult) => void;
}) {
  const busy = useRef(false);
  const [name, setName] = useState('dev-team');
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<SquadDeploymentStep | null>(null);
  const [message, setMessage] = useState('四个角色均使用集群默认模型，无需逐个配置。');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SquadDeploymentResult | null>(null);
  const nameError = developmentSquadNameError(name.trim());
  const stepIndex = STEPS.findIndex(item => item.id === step);

  const changeOpen = (next: boolean) => {
    if (busy.current) return;
    if (!next) {
      setName('dev-team'); setStep(null); setError(null); setResult(null);
      setMessage('四个角色均使用集群默认模型，无需逐个配置。');
    }
    onOpenChange(next);
  };

  const deploy = async () => {
    if (busy.current || nameError) return;
    busy.current = true; setPending(true); setError(null);
    try {
      const deployed = await deployDevelopmentSquad(name.trim(), (next, text) => { setStep(next); setMessage(text); });
      setResult(deployed);
      setMessage('Skill 已同步至资产库并关联 Agent；启动进度见小队列表。');
      onDeployed(deployed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '部署未完成');
    } finally {
      busy.current = false; setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Rocket className="size-4 text-emerald-500" aria-hidden="true" />部署开发小队</DialogTitle>
          <DialogDescription>创建 Leader、开发、代码评审和测试四个 Agent。Leader 确认指定 Issue 是 Bug 且没有对应 PR 后，再启动研发流程。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="development-squad-name">小队标识</Label>
            <Input id="development-squad-name" value={name} maxLength={10} disabled={pending || !!result}
              onChange={event => setName(event.target.value)} aria-invalid={!!nameError} aria-describedby="development-squad-name-hint" />
            <p id="development-squad-name-hint" className="text-xs text-muted-foreground">{nameError ?? 'Agent 名称会使用这个标识作为前缀。'}</p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <span className="font-medium">模型：</span>跟随集群默认模型
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {DEVELOPMENT_ROLES.map(role => (
              <li key={role.id} className="space-y-1 rounded-lg border px-3 py-2.5">
                <p className="text-sm font-medium">{role.title}</p>
                <p className="truncate text-xs text-muted-foreground">{name.trim()}-{role.id}</p>
                <p className="text-xs text-muted-foreground">{role.description}</p>
                <p className="text-xs"><span className="text-muted-foreground">关联资产：</span><span className="font-mono">{role.skillName}</span></p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">首次部署从官网同步角色 Skill；资产库已有同名 Skill 时直接复用，保留已有编辑。</p>
          {step && (
            <ol className="grid grid-cols-4 gap-2 text-xs" aria-label="部署进度">
              {STEPS.map((item, index) => (
                <li key={item.id} className={`flex items-center gap-1 ${index <= stepIndex ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                  {result || index < stepIndex ? <Check className="size-3.5" aria-hidden="true" /> : pending && index === stepIndex ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <span>{index + 1}.</span>}
                  {item.label}
                </li>
              ))}
            </ol>
          )}
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{message}</p>
          {error && <div role="alert" className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><p>{error}</p><p className="text-xs">已创建的资源会保留，使用同一小队标识重试可继续部署。</p></div>}
        </div>
        <DialogFooter>
          {result ? <Button onClick={() => changeOpen(false)}>完成</Button> : <>
            <Button variant="outline" disabled={pending} onClick={() => changeOpen(false)}>取消</Button>
            <Button disabled={pending || !!nameError} onClick={() => void deploy()}>
              {pending && <Loader2 className="mr-1 size-4 animate-spin" aria-hidden="true" />}
              {pending ? '正在部署' : error ? '重试部署' : '一键部署'}
            </Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
