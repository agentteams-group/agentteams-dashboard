import type { DisplayMessage } from '@/hooks/use-matrix';

/**
 * Group messages for display, determining continuation state.
 *
 * A continuation hides the sender avatar/name when the previous message was
 * sent by the same person within 5 minutes and on the same day.
 */
export interface GroupedMessage {
  message: DisplayMessage;
  showSender: boolean;
  isContinuation: boolean;
}

const CONTINUATION_MAX_INTERVAL_MS = 5 * 60 * 1000;

function isDifferentDay(ts1: number, ts2: number): boolean {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return d1.toDateString() !== d2.toDateString();
}

export function buildGroupedMessages(messages: DisplayMessage[]): GroupedMessage[] {
  const result: GroupedMessage[] = [];

  messages.forEach((msg, i) => {
    const prev = i > 0 ? result[i - 1]?.message : null;

    let showSender = true;
    let isContinuation = false;

    if (prev) {
      const timeDiff = msg.timestamp - prev.timestamp;
      const sameSender = prev.sender === msg.sender;
      const withinInterval = timeDiff <= CONTINUATION_MAX_INTERVAL_MS;
      const sameDay = !isDifferentDay(prev.timestamp, msg.timestamp);
      const sameType = prev.type === msg.type;

      if (sameSender && withinInterval && sameDay && sameType) {
        showSender = false;
        isContinuation = true;
      }
    }

    result.push({ message: msg, showSender, isContinuation });
  });

  return result;
}

export function getMessageDateKey(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
