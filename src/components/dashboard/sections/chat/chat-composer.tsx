'use client';

import { useRef } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ChatComposerProps {
  value: string;
  onChange: (_value: string) => void;
  onSend: () => void;
  isSending: boolean;
  sendError: string | null;
  placeholder: string;
  disabled: boolean;
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  isSending,
  sendError,
  placeholder,
  disabled,
}: ChatComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!value.trim() || isSending) return;
    onSend();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const autoResize = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 100) + 'px';
  };

  return (
    <div className="border-t border-border px-3 py-2 shrink-0 bg-card/20">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 resize-none rounded-lg border border-border bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-500/50 min-h-[36px] max-h-[100px] placeholder:text-muted-foreground/50"
          rows={1}
          style={{ height: 'auto', overflow: 'hidden' }}
          onInput={autoResize}
        />
        <Button
          size="sm"
          className="h-9 w-9 p-0 shrink-0"
          onClick={handleSend}
          disabled={!value.trim() || isSending}
        >
          {isSending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
      {sendError && <p className="text-red-500 text-[10px] mt-1">发送失败: {sendError}</p>}
    </div>
  );
}
