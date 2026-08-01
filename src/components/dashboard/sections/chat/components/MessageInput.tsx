'use client';

import { useState, useEffect, useRef } from 'react';

interface MessageInputProps {
  canSend: boolean;
  onSend: (_content: string, _options?: { html?: boolean }) => void;
  isLoading?: boolean;
}

export function MessageInput({ canSend, onSend, isLoading = false }: MessageInputProps) {
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [value]);

  const handleSubmit = () => {
    if (!canSend || !value.trim() || isLoading) return;

    onSend(value.trim());
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  return (
    <div className={`border-t bg-card p-3 transition-all ${
      isFocused ? 'border-primary/30' : ''
    }`}>
      <div className="flex gap-2 items-end">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            rows={1}
            className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm 
                       placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50
                       min-h-[40px] max-h-[120px]"
            disabled={isLoading}
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={!canSend || !value.trim() || isLoading}
          className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium
                     hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                     transition-all flex items-center gap-1"
        >
          {isLoading ? (
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
          <span>发送</span>
        </button>
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">
        Enter 发送 · Shift+Enter 换行
      </div>
    </div>
  );
}
