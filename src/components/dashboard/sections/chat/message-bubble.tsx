'use client';

import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { escapeHtml } from '@/lib/utils';
import type { DisplayMessage } from '@/hooks/use-matrix';
import { formatTime, getAvatarColor, renderFormattedContent } from './format';

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
      <div className={`max-w-[75%] min-w-0 ${message.isMe ? 'items-end' : 'items-start'}`}>
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
          </div>
        )}
        <div
          className={`rounded-xl px-3 py-2 text-sm break-words inline-block ${
            message.isMe
              ? 'bg-orange-500/15 text-foreground rounded-tr-sm'
              : isNotice
                ? 'bg-violet-500/10 text-foreground rounded-tl-sm border border-violet-500/10'
                : 'bg-muted/80 text-foreground rounded-tl-sm'
          }`}
        >
          {message.formattedContent ? (
            <div
              className="matrix-html-content [&>p]:mb-1 [&>br]:block [&>pre]:bg-muted/50 [&>pre]:rounded [&>pre]:p-2 [&>code]:bg-muted/50 [&>code]:px-1 [&>code]:rounded text-sm"
              dangerouslySetInnerHTML={{
                __html: renderFormattedContent(message.formattedContent, message.content).html,
              }}
            />
          ) : (
            <p
              className="whitespace-pre-wrap"
              dangerouslySetInnerHTML={{
                __html: escapeHtml(message.content).replace(/\n/g, '<br />'),
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
