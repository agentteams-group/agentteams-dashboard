'use client';

import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Check, Clock, AlertCircle } from 'lucide-react';
import type { DisplayMessage } from '@/hooks/use-matrix';
import { useMatrixStore } from '@/lib/matrix-store';
import { formatTime, getAvatarColor } from './format';
import { MarkdownMessage } from './markdown-message';
import { A2uiChatContent } from './a2ui';

function MessageStatus({ status }: { status?: 'sending' | 'sent' | 'error' }) {
  if (!status) return null;
  switch (status) {
    case 'sending':
      return <Clock className="w-3 h-3 text-muted-foreground/60 animate-pulse" />;
    case 'sent':
      return <Check className="w-3 h-3 text-muted-foreground/60" />;
    case 'error':
      return <AlertCircle className="w-3 h-3 text-red-500" />;
  }
}

export function MessageBubble({
  message,
  showSender,
}: {
  message: DisplayMessage;
  showSender: boolean;
}) {
  const time = formatTime(message.timestamp);
  const isNotice = message.type === 'm.notice';
  const avatarColor = getAvatarColor(message.sender);
  const homeserver = useMatrixStore((s) => s.homeserver);

  // Check if this is a media message (m.image, m.file)
  const isMedia = message.type === 'm.image' || message.type === 'm.file';

  return (
    <div
      className={`flex gap-2 ${message.isMe ? 'flex-row-reverse' : 'flex-row'} ${
        showSender ? 'mt-3' : 'mt-0.5'
      }`}
    >
      {showSender ? (
        <Avatar className="w-7 h-7 shrink-0">
          <AvatarFallback className={`text-[10px] ${avatarColor}`}>
            {message.senderShort.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="w-7 shrink-0" />
      )}
      <div className={`max-w-[80%] min-w-0 ${message.isMe ? 'items-end' : 'items-start'}`}>
        {showSender && (
          <div className={`flex items-center gap-2 mb-1 ${message.isMe ? 'justify-end' : ''}`}>
            <span className="text-[10px] font-medium text-muted-foreground">
              {message.senderShort}
            </span>
            <span className="text-[10px] text-muted-foreground/50">{time}</span>
            {isNotice && (
              <Badge
                variant="outline"
                className="text-[8px] px-1 py-0 h-3.5 border-violet-500/30 text-violet-500"
              >
                Bot
              </Badge>
            )}
            {message.isStreaming && (
              <Badge
                variant="outline"
                className="text-[8px] px-1 py-0 h-3.5 border-cyan-500/30 text-cyan-500"
              >
                流式输出中
              </Badge>
            )}
          </div>
        )}
        <div
          className={`rounded-xl px-3 py-2 text-sm break-words inline-block overflow-hidden ${
            message.isMe
              ? 'bg-orange-500/15 text-foreground rounded-tr-sm'
              : isNotice
                ? 'bg-violet-500/10 text-foreground rounded-tl-sm border border-violet-500/10'
                : 'bg-muted/80 text-foreground rounded-tl-sm'
          }`}
        >
          {/* Media messages use MarkdownMessage for mxc:// URL resolution */}
          {isMedia ? (
            <MarkdownMessage
              content={message.content}
              formattedContent={message.formattedContent}
              msgType={message.type}
              mediaUrl={message.mediaUrl}
              mediaInfo={message.mediaInfo}
              homeserver={homeserver}
            />
          ) : (
            /* Text messages use A2UI renderer for thinking/tool-call/streaming support */
            <A2uiChatContent
              content={message.content}
              formattedContent={message.formattedContent}
              isStreaming={message.isStreaming}
              messageId={message.id}
            />
          )}
        </div>
        {message.isMe && (
          <div className={`flex items-center gap-1 mt-0.5 ${message.isMe ? 'justify-end' : ''}`}>
            <MessageStatus status={message.status} />
          </div>
        )}
      </div>
    </div>
  );
}
