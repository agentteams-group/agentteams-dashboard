'use client';

import { motion } from 'framer-motion';
import { Lock, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function MatrixStatusBanner({
  isLoggedIn,
  onLoginClick,
}: {
  isLoggedIn: boolean;
  onLoginClick: () => void;
}) {
  if (isLoggedIn) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5 flex items-center gap-2"
    >
      <Lock className="w-4 h-4 text-amber-500 shrink-0" />
      <p className="text-xs text-amber-600 dark:text-amber-400 flex-1">
        未登录 Matrix - 可以查看房间列表，但无法查看消息和发送消息
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-6 text-xs border-amber-500/30 text-amber-600 dark:text-amber-400"
        onClick={onLoginClick}
      >
        <LogIn className="w-3 h-3 mr-1" />
        登录
      </Button>
    </motion.div>
  );
}
