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
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const length = [...password].length;
  const mismatch = Boolean(confirmation) && password !== confirmation;
  const valid = length >= 8 && length <= 128 && Boolean(password.trim()) && password === confirmation;

  async function reset() {
    if (pending || !valid) return;
    setPending(true);
    setError('');
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
            <Input id="reset-human-password" type="password" autoComplete="new-password" placeholder="8–128 个字符" value={password}
              onChange={(event) => setPassword(event.target.value)} disabled={pending} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-human-password">确认新密码</Label>
            <Input id="confirm-human-password" type="password" autoComplete="new-password" value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)} disabled={pending} aria-invalid={mismatch} />
            {mismatch && <p className="text-sm text-destructive">两次输入的密码不一致</p>}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>取消</Button>
            <Button type="submit" disabled={!valid || pending}>{pending ? '重置中…' : '重置密码'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
