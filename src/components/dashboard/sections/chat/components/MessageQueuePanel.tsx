'use client';

import { useState } from 'react';
import { ArrowUpRight, ChevronUp, ListOrdered, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { isDesktopHover, useHoverOpen } from '@/lib/desktop-interactions';
import type { QueuedChatMessage } from '@/lib/chat-message-queue';

interface MessageQueuePanelProps {
  messages: QueuedChatMessage[];
  sendingId?: string;
  disabled?: boolean;
  onSend: (_id: string) => void;
  onRemove: (_id: string) => void;
}

export function MessageQueuePanel({ messages, sendingId, disabled, onSend, onRemove }: MessageQueuePanelProps) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const hover = useHoverOpen({ onOpenChange: open => { if (!open) setPreviewId(null); } });
  const preview = messages.find(message => message.id === previewId);
  if (!messages.length) return null;

  return (
    <Popover open={hover.open} onOpenChange={hover.setOpen}>
      <PopoverTrigger asChild {...hover.triggerProps}>
        <button type="button" className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={`${messages.length} 条排队中`}>
          <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
          <span><span className="font-medium tabular-nums text-foreground">{messages.length}</span> 条排队中</span>
          <ChevronUp className={`h-3 w-3 transition-transform ${hover.open ? '' : 'rotate-180'}`} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent {...hover.contentProps} onOpenAutoFocus={hover.preserveFocus} onCloseAutoFocus={hover.preserveFocus}
        side="top" align="end" sideOffset={8} aria-label="待发送消息队列"
        className="w-[min(30rem,calc(100vw-2rem))] rounded-xl p-0 shadow-lg">
        <Popover open={Boolean(preview)} onOpenChange={open => { if (!open) setPreviewId(null); }}>
          <PopoverAnchor asChild>
            <div data-message-queue-panel>
              <div className="border-b border-border/60 px-4 py-3">
                <p className="text-sm font-medium">待发送 <span className="ml-1 text-xs font-normal tabular-nums text-muted-foreground">{messages.length}</span></p>
                <p className="mt-1 text-xs text-muted-foreground">当前回复结束后，按顺序发送</p>
              </div>
              <ol className="max-h-[min(19rem,40dvh)] overflow-y-auto overscroll-contain p-1.5">
                {messages.map((message, index) => (
                  <li key={message.id} className={`group flex items-start gap-2 rounded-lg p-2 transition-colors hover:bg-muted/60 ${previewId === message.id ? 'bg-muted/60' : ''}`}
                    onPointerEnter={event => { if (isDesktopHover(event)) setPreviewId(message.id); }}>
                    <span className="w-5 shrink-0 pt-1 font-mono text-xs tabular-nums text-muted-foreground/70">{String(index + 1).padStart(2, '0')}</span>
                    <button type="button" className="min-w-0 flex-1 rounded py-0.5 text-left focus-visible:outline-2 focus-visible:outline-ring"
                      aria-label={`查看第 ${index + 1} 条排队消息全文`} onFocus={() => setPreviewId(message.id)} onClick={() => setPreviewId(message.id)}>
                      <span className="line-clamp-2 break-words text-sm leading-6">{message.request.body}</span>
                      {message.error && <span className="mt-1 block text-xs leading-5 text-destructive">发送失败，内容已保留：{message.error}</span>}
                      {sendingId === message.id && <span className="mt-1 block text-xs text-muted-foreground">正在发送…</span>}
                    </button>
                    <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
                      <Button variant="ghost" size="sm" className="h-7 gap-1 rounded-md px-2 text-xs"
                        aria-label={`插队发送第 ${index + 1} 条消息`} disabled={disabled || Boolean(sendingId)} onClick={() => onSend(message.id)}>
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />插队
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-destructive"
                        aria-label={`删除第 ${index + 1} 条排队消息`} disabled={sendingId === message.id} onClick={() => onRemove(message.id)}>
                        <Trash2 className="h-3 w-3" aria-hidden="true" /><span className="hidden sm:inline">删除</span>
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </PopoverAnchor>
          <PopoverContent {...hover.contentProps} side="top" align="end" sideOffset={8} aria-label="排队消息全文"
            onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
            onInteractOutside={event => {
              if (event.target instanceof Element && event.target.closest('[data-message-queue-panel]')) event.preventDefault();
            }}
            className="w-[min(30rem,calc(100vw-2rem))] rounded-xl p-0 shadow-lg">
            <p className="border-b border-border/60 px-4 py-2.5 text-xs font-medium text-muted-foreground">消息全文</p>
            <p className="max-h-[min(18rem,32dvh)] overflow-y-auto overscroll-contain whitespace-pre-wrap break-words px-4 py-3 text-sm leading-7">{preview?.request.body}</p>
          </PopoverContent>
        </Popover>
      </PopoverContent>
    </Popover>
  );
}
