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
  const names = users.map((u) => u.displayName);
  let nameText = '';
  let statusText = '正在输入';
  if (names.length === 1) {
    nameText = names[0];
  } else if (names.length === 2) {
    nameText = `${names[0]} 和 ${names[1]}`;
  } else if (names.length > 2) {
    nameText = names[0];
    statusText = `等 ${names.length} 人正在输入`;
  }
  const text = `${nameText} ${statusText}`;

  return (
    <div data-chat-typing role="status" aria-live="polite" aria-atomic="true" className="h-6 shrink-0 px-3 sm:px-6">
      <div className={`mx-auto flex h-full w-full min-w-0 items-center px-4 ${CHAT_COLUMN_CLASS}`}>
        <AnimatePresence>
          {users.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"
            >
              <span className="flex shrink-0 gap-0.5" aria-hidden="true">
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
              <span className="flex min-w-0 items-center gap-1" title={text}>
                <span data-chat-typing-name className="truncate">{nameText}</span>{' '}
                <span className="shrink-0 whitespace-nowrap">{statusText}</span>
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
