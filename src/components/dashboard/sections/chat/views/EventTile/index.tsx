'use client';

import { MessageBubble } from '../MessageBubble';
import type { DisplayMessage } from '@/hooks/use-matrix';

interface EventTileProps {
  _message: DisplayMessage;
  showSender: boolean;
  isContinuation: boolean;
  onReply?: (message: DisplayMessage) => void;
  onCopy?: (message: DisplayMessage) => void;
  onOpenThread?: (message: DisplayMessage) => void;
  memberMap?: Record<string, string>;
}

export function EventTile({
  _message,
  showSender,
  isContinuation,
  onReply,
  onCopy,
  onOpenThread,
  memberMap,
}: EventTileProps) {
  return (
    <MessageBubble
      message={_message}
      showSender={showSender}
      isContinuation={isContinuation}
      onReply={onReply}
      onCopy={onCopy}
      onOpenThread={onOpenThread}
      memberMap={memberMap}
    />
  );
}
