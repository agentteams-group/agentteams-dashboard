'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { CHAT_COLUMN_CLASS } from './layout';

interface TypingUser {
  userId: string;
  displayName: string;
}

interface TypingIndicatorProps {
  users: TypingUser[];
}

export function TypingIndicator({ users }: TypingIndicatorProps) {
  if (users.length === 0) return null;

  const names = users.map((u) => u.displayName);
  let text: string;
  if (names.length === 1) {
    text = `${names[0]} 正在输入`;
  } else if (names.length === 2) {
    text = `${names[0]} 和 ${names[1]} 正在输入`;
  } else {
    text = `${names[0]} 等 ${names.length} 人正在输入`;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        className={`mx-auto w-full ${CHAT_COLUMN_CLASS} px-4 py-1.5`}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex gap-0.5">
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
            />
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
            />
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
            />
          </span>
          <span>{text}</span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
