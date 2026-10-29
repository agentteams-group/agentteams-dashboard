'use client';

import { MessageBubble } from '../MessageBubble';
import type { DisplayMessage } from '@/hooks/use-matrix';
import type { ReadReceiptEntry } from '@/hooks/use-matrix';
import type { WorkerSessionState } from '@/lib/worker-session-state';
import type { AnswerSendResult, ConfirmationAnswerField } from '../../confirmation-reply';

interface EventTileProps {
  _message: DisplayMessage;
  showSender: boolean;
  isContinuation: boolean;
  onReply?: (_message: DisplayMessage) => void;
  onCopy?: (_message: DisplayMessage) => boolean | void | Promise<boolean | void>;
  onOpenThread?: (_message: DisplayMessage) => void;
  onEdit?: (_message: DisplayMessage, _newContent: string) => Promise<void> | void;
  onDelete?: (_message: DisplayMessage) => void;
  onResend?: (_message: DisplayMessage) => void;
  onCancel?: (_message: DisplayMessage) => void;
  onSendConfirmation?: (_content: string, _sender?: string, _eventId?: string, _answer?: ConfirmationAnswerField) => AnswerSendResult;
  onOpenWorkerFiles?: (_message: DisplayMessage) => void;
  memberMap?: Record<string, string>;
  readReceipts?: Record<string, ReadReceiptEntry>;
  currentUserId?: string | null;
  /** Live session state of the sender when it is a worker (A17 dot). */
  senderStatus?: WorkerSessionState | null;
  /** Opens a worker's read-only QwenPaw sessions (avatar click, C / #1295). */
  onOpenWorkerChats?: (_workerName: string) => void;
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
  senderStatus,
  onOpenWorkerChats,
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
      senderStatus={senderStatus}
      onOpenWorkerChats={onOpenWorkerChats}
    />
  );
}
