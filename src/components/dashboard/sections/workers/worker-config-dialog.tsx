'use client';

import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function WorkerConfigDialog({
  open,
  value,
  onChange,
  onOpenChange,
  onApply,
  isPending,
  error,
}: {
  open: boolean;
  value: string;
  onChange: (_next: string) => void;
  onOpenChange: (_open: boolean) => void;
  onApply: () => void;
  isPending: boolean;
  error: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>JSON 应用</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-4">
          <Label>粘贴 Worker JSON 配置</Label>
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder='{"name": "worker-x", "runtime": "openclaw", "model": "gpt-4"}'
            rows={12}
            className="font-mono text-xs"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              onChange('');
            }}
          >
            取消
          </Button>
          <Button
            onClick={onApply}
            disabled={isPending || !value.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isPending ? '创建中...' : '应用'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
