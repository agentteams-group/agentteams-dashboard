'use client';

import { MessageBubble } from '../MessageBubble';
import type { DisplayMessage } from '@/hooks/use-matrix';

interface EventTileProps {
  message: DisplayMessage;
  showSender: boolean;
  isContinuation: boolean;
}

export function EventTile({ message, showSender, isContinuation }: EventTileProps) {
  return (
    <MessageBubble
      message={message}
      showSender={showSender}
      isContinuation={isContinuation}
    />
  );
}
