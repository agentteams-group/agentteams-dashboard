'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { MoonStar, SunMedium, Trash2, XSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export type BulkAction = 'sleep' | 'wake' | 'delete';

const ACTION_LABEL: Record<BulkAction, string> = {
  sleep: '休眠',
  wake: '唤醒',
  delete: '删除',
};

export function WorkerBulkBar({
  count,
  onTrigger,
  onClear,
}: {
  count: number;
  onTrigger: (_action: BulkAction) => void;
  onClear: () => void;
}) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 glass-card px-4 py-3 rounded-xl border border-primary/20 shadow-lg flex items-center gap-3"
        >
          <span className="text-sm font-medium">已选择 {count} 个 Worker</span>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onTrigger('wake')}>
            <SunMedium className="w-3 h-3 mr-1" aria-hidden="true" />
            批量唤醒
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onTrigger('sleep')}>
            <MoonStar className="w-3 h-3 mr-1" aria-hidden="true" />
            批量休眠
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={() => onTrigger('delete')}
          >
            <Trash2 className="w-3 h-3 mr-1" aria-hidden="true" />
            批量删除
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClear}>
            <XSquare className="w-3 h-3 mr-1" aria-hidden="true" />
            取消选择
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function WorkerBulkConfirm({
  action,
  count,
  onClose,
  onConfirm,
}: {
  action: BulkAction | null;
  count: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={!!action} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认批量操作</AlertDialogTitle>
          <AlertDialogDescription>
            确定要{action ? ACTION_LABEL[action] : ''} {count} 个 Worker 吗？
            {action === 'delete' && '此操作不可撤销。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={action === 'delete' ? 'bg-destructive text-destructive-foreground' : ''}
          >
            确认
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
