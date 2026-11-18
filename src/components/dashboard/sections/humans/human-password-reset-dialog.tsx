'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { agentteamsApi, type HumanResponse } from '@/lib/agentteams-api';
import { formatErrorMessage } from '@/lib/api-error';

export function HumanPasswordResetDialog({ human, onClose }: {
  human: HumanResponse;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const length = [...password].length;
  const passwordIssue = !password
    ? submitted ? '请输入新密码' : ''
    : length < 8 || length > 128
      ? `已输入 ${length} 个字符，需要 8–128 个字符`
      : !password.trim() ? '密码不能全是空白字符' : '';
  const confirmationIssue = !confirmation
    ? submitted ? '请再次输入新密码' : ''
    : password !== confirmation ? '两次输入的密码不一致' : '';

  async function reset() {
    if (pending) return;
    setSubmitted(true);
    setError('');
    if (!password || !confirmation || passwordIssue || confirmationIssue) return;
    setPending(true);
    try {
      await agentteamsApi.resetHumanPassword(human.name, password);
      void queryClient.invalidateQueries({ queryKey: ['agentteams-human-detail', human.name] });
      void queryClient.invalidateQueries({ queryKey: ['agentteams-human-config', human.name] });
      toast.success('密码已重置');
      onClose();
    } catch (err) {
      setError(formatErrorMessage(err, '密码重置失败'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>重置密码</DialogTitle>
          <DialogDescription>为 {human.name} 设置新密码。重置后，该用户需要重新登录对话。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void reset(); }}>
          <div className="space-y-2">
            <Label htmlFor="reset-human-password">新密码</Label>
            <Input id="reset-human-password" type="password" autoComplete="new-password" value={password}
              onChange={(event) => setPassword(event.target.value)} disabled={pending}
              aria-invalid={Boolean(passwordIssue)} aria-describedby="reset-human-password-help" />
            <p id="reset-human-password-help" aria-live="polite" className={`text-xs ${passwordIssue ? 'text-destructive' : 'text-muted-foreground'}`}>
              {passwordIssue || '8–128 个字符'}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-human-password">确认新密码</Label>
            <Input id="confirm-human-password" type="password" autoComplete="new-password" value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)} disabled={pending}
              aria-invalid={Boolean(confirmationIssue)} aria-describedby={confirmationIssue ? 'confirm-human-password-help' : undefined} />
            {confirmationIssue && <p id="confirm-human-password-help" className="text-xs text-destructive">{confirmationIssue}</p>}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>取消</Button>
            <Button type="submit" disabled={pending}>{pending ? '重置中…' : '重置密码'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
