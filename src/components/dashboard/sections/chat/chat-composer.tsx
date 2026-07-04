'use client';

import { useRef, useState } from 'react';
import { RefreshCw, Send, Bold, Italic, Code, Link2, Eye, EyeOff } from 'lucide-react';
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
  const [preview, setPreview] = useState(false);

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
    target.style.height = Math.min(target.scrollHeight, 120) + 'px';
  };

  const insertAtCursor = (before: string, after: string = '') => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    const newValue = value.slice(0, start) + before + selected + after + value.slice(end);
    onChange(newValue);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + before.length + selected.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="border-t border-border p-3 shrink-0 bg-card/30">
      <div className="flex items-center gap-1 mb-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => insertAtCursor('**', '**')}
          disabled={disabled}
          title="粗体"
        >
          <Bold className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => insertAtCursor('*', '*')}
          disabled={disabled}
          title="斜体"
        >
          <Italic className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => insertAtCursor('`', '`')}
          disabled={disabled}
          title="行内代码"
        >
          <Code className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => insertAtCursor('[', '](url)')}
          disabled={disabled}
          title="链接"
        >
          <Link2 className="w-3.5 h-3.5" />
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setPreview(!preview)}
          disabled={!value.trim()}
        >
          {preview ? <EyeOff className="w-3.5 h-3.5 mr-1" /> : <Eye className="w-3.5 h-3.5 mr-1" />}
          预览
        </Button>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          {preview ? (
            <div className="w-full min-h-[36px] max-h-[120px] overflow-y-auto rounded-lg border border-border bg-background/50 px-3 py-2 text-sm">
              <MarkdownPreview content={value} />
            </div>
          ) : (
            <textarea
              ref={inputRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              className="w-full resize-none rounded-lg border border-border bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-500/50 min-h-[36px] max-h-[120px] placeholder:text-muted-foreground/50"
              rows={1}
              style={{ height: 'auto', overflow: 'hidden' }}
              onInput={autoResize}
            />
          )}
        </div>
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

function MarkdownPreview({ content }: { content: string }) {
  const html = content
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\n/g, '<br />');
  return <div className="text-sm" dangerouslySetInnerHTML={{ __html: html }} />;
}
