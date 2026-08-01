'use client';

import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { DisplayMessage } from '@/hooks/use-matrix';
import { MarkdownMessage } from '../markdown-message';

interface MessageBubbleProps {
  message: DisplayMessage;
  showSender: boolean;
  isContinuation: boolean;
  onReply?: (message: DisplayMessage) => void;
  onCopy?: (message: DisplayMessage) => void;
  onOpenThread?: (message: DisplayMessage) => void;
  memberMap?: Record<string, string>;
}

function MessageTime({ timestamp }: { timestamp: number }) {
  const time = new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <span className="text-[10px] text-muted-foreground/60 select-none">
      {time}
    </span>
  );
}

function AvatarWithInitials({ senderShort, isMe }: { senderShort: string; isMe: boolean }) {
  return (
    <Avatar className="w-7 h-7 shrink-0">
      <div className={`w-full h-full rounded-full flex items-center justify-center text-xs font-medium ${
        isMe
          ? 'bg-primary/20 text-primary'
          : 'bg-muted text-muted-foreground'
      }`}>
        {senderShort.slice(0, 2).toUpperCase()}
      </div>
    </Avatar>
  );
}

export function MessageBubble({
  message,
  showSender,
  isContinuation,
  onReply,
  onCopy,
  onOpenThread,
  memberMap,
}: MessageBubbleProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={`flex gap-2 px-3 py-0.5 group/message ${
        !isContinuation ? 'mt-2' : ''
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="w-7 shrink-0">
        {!isContinuation && showSender && (
          <AvatarWithInitials senderShort={message.senderShort} isMe={message.isMe} />
        )}
        {isContinuation && <div className="w-7" />}
      </div>

      <div className="flex-1 min-w-0">
        {!isContinuation && showSender && (
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`text-xs font-medium ${
              message.isMe ? 'text-primary' : 'text-foreground'
            }`}>
              {message.senderShort}
            </span>
            {message.isStreaming && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                <span className="animate-pulse">streaming</span>
              </Badge>
            )}
            {message.isEdited && (
              <span className="text-[10px] text-muted-foreground italic">(edited)</span>
            )}
            {message.replyCount && message.replyCount > 0 && onOpenThread && (
              <button
                onClick={() => onOpenThread(message)}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                title="查看回复"
              >
                ↩ {message.replyCount}
              </button>
            )}
          </div>
        )}

        <div className={`flex items-end gap-2 ${message.isMe ? 'flex-row-reverse' : ''}`}>
          <div
            className={`max-w-[80%] px-3 py-1.5 rounded-2xl text-sm ${
              message.isMe
                ? 'bg-primary text-primary-foreground rounded-tr-sm'
                : 'bg-muted text-foreground rounded-tl-sm'
            }`}
          >
            <MarkdownMessage
              content={message.content}
              formattedContent={message.formattedContent}
              msgType={message.type}
              mediaUrl={message.mediaUrl}
              mediaInfo={message.mediaInfo}
              memberMap={memberMap}
            />
          </div>

          <div className={`text-[10px] ${
            message.isMe ? 'order-first' : ''
          } ${
            isContinuation && !isHovered ? 'opacity-0 group-hover/message:opacity-100' : ''
          }`}>
            <MessageTime timestamp={message.timestamp} />
          </div>
        </div>

        {isHovered && !isContinuation && (
          <div className={`flex gap-1 mt-1 ${message.isMe ? 'justify-end' : 'justify-start'}`}>
            {onReply && (
              <button
                onClick={() => onReply(message)}
                className="opacity-0 group-hover/message:opacity-100 text-muted-foreground hover:text-foreground transition-opacity p-1"
                title="回复"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </button>
            )}
            {onCopy && (
              <button
                onClick={() => onCopy(message)}
                className="opacity-0 group-hover/message:opacity-100 text-muted-foreground hover:text-foreground transition-opacity p-1"
                title="复制"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
