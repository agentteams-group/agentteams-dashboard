'use client';

import { MessageBubble } from '../MessageBubble';
import type { DisplayMessage } from '@/hooks/use-matrix';
import type { ReadReceiptEntry } from '@/hooks/use-matrix';

interface EventTileProps {
  _message: DisplayMessage;
  showSender: boolean;
  isContinuation: boolean;
  onReply?: (_message: DisplayMessage) => void;
  onCopy?: (_message: DisplayMessage) => void;
  onOpenThread?: (_message: DisplayMessage) => void;
  onEdit?: (_message: DisplayMessage, _newContent: string) => Promise<void> | void;
  onDelete?: (_message: DisplayMessage) => void;
  onResend?: (_message: DisplayMessage) => void;
  onCancel?: (_message: DisplayMessage) => void;
  onSendConfirmation?: (_content: string) => void;
  onOpenWorkerFiles?: (_message: DisplayMessage) => void;
  memberMap?: Record<string, string>;
  readReceipts?: Record<string, ReadReceiptEntry>;
  currentUserId?: string | null;
}

export function EventTile({
  _message,
  showSender,
  isContinuation,
  onReply,
  onCopy,
  onOpenThread,
  onEdit,
  onDelete,
  onResend,
  onCancel,
  onSendConfirmation,
  onOpenWorkerFiles,
  memberMap,
  readReceipts,
  currentUserId,
}: EventTileProps) {
  return (
    <MessageBubble
      message={_message}
      showSender={showSender}
      isContinuation={isContinuation}
      onReply={onReply}
      onCopy={onCopy}
      onOpenThread={onOpenThread}
      onEdit={onEdit}
      onDelete={onDelete}
      onResend={onResend}
      onCancel={onCancel}
      onSendConfirmation={onSendConfirmation}
      onOpenWorkerFiles={onOpenWorkerFiles}
      memberMap={memberMap}
      readReceipts={readReceipts}
      currentUserId={currentUserId}
    />
  );
}
