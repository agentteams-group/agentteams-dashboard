'use client';

import { useRef, useState } from 'react';
import { Loader2, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DEVELOPMENT_ROLES, developmentSquadNameError, developmentSquadRepositoryError, deployDevelopmentSquad, type SquadDeploymentResult } from '@/lib/development-squad';

export function DevelopmentSquadDialog({ open, onOpenChange, onRequested }: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onRequested: (_result: SquadDeploymentResult) => void;
}) {
  const busy = useRef(false);
  const requestId = useRef<string | null>(null);
  const [name, setName] = useState('dev-team');
  const [repository, setRepository] = useState('');
  const [model, setModel] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameError = developmentSquadNameError(name.trim());
  const repositoryError = developmentSquadRepositoryError(repository.trim());

  const changeOpen = (next: boolean) => {
    if (busy.current) return;
    if (!next) {
      setError(null);
      requestId.current = null;
    }
    onOpenChange(next);
  };

  const deploy = async () => {
    if (busy.current || nameError || repositoryError) return;
    busy.current = true; setPending(true); setError(null);
    requestId.current ??= crypto.randomUUID();
    try {
      const receipt = await deployDevelopmentSquad({ name: name.trim(), repository: repository.trim(), model: model.trim() || undefined, requestId: requestId.current });
      onRequested(receipt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '部署请求未确认');
    } finally {
      busy.current = false; setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Rocket className="size-4 text-emerald-500" aria-hidden="true" />部署开发小队</DialogTitle>
          <DialogDescription>交给 Manager 创建四个 Codex Agent、同步 Skill 资产并组建团队。收到请求后自动打开 Manager 会话查看办理进度。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="development-squad-name">小队标识</Label>
            <Input id="development-squad-name" value={name} maxLength={10} disabled={pending}
              onChange={event => setName(event.target.value)} aria-invalid={!!nameError} aria-describedby="development-squad-name-hint" />
            <p id="development-squad-name-hint" className="text-xs text-muted-foreground">{nameError ?? 'Agent 名称会使用这个标识作为前缀。'}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="development-squad-repository">负责仓库</Label>
            <Input id="development-squad-repository" value={repository} placeholder="owner/repository" disabled={pending} onChange={event => setRepository(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="development-squad-model">统一模型（选填）</Label>
            <Input id="development-squad-model" value={model} placeholder="留空使用当前集群默认模型" disabled={pending} onChange={event => setModel(event.target.value)} />
            <p className="text-xs text-muted-foreground">四个角色统一使用 Codex。指定模型时，Manager 先验证可用性；无法访问时会报告阻塞。</p>
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
          <p className="text-xs text-muted-foreground">Leader 每 30 分钟检查新 Issue 并发送待确认提示。你确认后才创建 Task；同一 Issue 复用 Task 和团队。已有同名 Skill 资产保留编辑。</p>
          {pending && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">正在发送给 Manager，资源创建结果以 Manager 的实际回执为准。</p>}
          {error && <div role="alert" className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><p>{error}</p><p className="text-xs">发送结果不明确时，请先查看 Manager 会话，再决定是否重试。</p></div>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => changeOpen(false)}>取消</Button>
          <Button disabled={pending || !!nameError || !!repositoryError} onClick={() => void deploy()}>
            {pending && <Loader2 className="mr-1 size-4 animate-spin" aria-hidden="true" />}
            {pending ? '正在发送' : '一键部署'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
