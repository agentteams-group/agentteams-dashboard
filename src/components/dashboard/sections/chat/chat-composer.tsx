'use client';

import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { RefreshCw, Send, Paperclip, HelpCircle, Trash2, Users, Hash, Pencil, X, Drama, PersonStanding } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { getAvatarColor } from './format';
import { filterEmoji } from './composer-commands';

/** A single @mention that was inserted into the input */
export interface MentionEntry {
  userId: string;       // e.g. @worker:matrix.server
  displayName: string;  // e.g. worker
  placeholder: string;  // e.g. @worker  (what appears in the textarea)
}

interface Member {
  userId: string;
  displayName: string;
  avatarUrl?: string;
}

/** Composer-level edit session for the "ArrowUp edits my last message" flow */
export interface ComposerEditSession {
  eventId: string;
  initialText: string;
}

interface SlashCommand {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'help', label: '/help', description: '显示帮助信息', icon: <HelpCircle className="w-3.5 h-3.5" /> },
  { id: 'clear', label: '/clear', description: '清空当前输入', icon: <Trash2 className="w-3.5 h-3.5" /> },
  { id: 'members', label: '/members', description: '切换成员列表', icon: <Users className="w-3.5 h-3.5" /> },
  { id: 'me', label: '/me', description: '以动作形式发送 (如 /me 正在重启)', icon: <Drama className="w-3.5 h-3.5" /> },
  { id: 'shrug', label: '/shrug', description: '追加 ¯\\_(ツ)_/¯ 发送', icon: <PersonStanding className="w-3.5 h-3.5" /> },
  { id: 'topic', label: '/topic', description: '设置房间主题 (需参数)', icon: <Hash className="w-3.5 h-3.5" /> },
];

interface ChatComposerProps {
  value: string;
  onChange: (_value: string) => void;
  onSend: () => void;
  isSending: boolean;
  sendError: string | null;
  placeholder: string;
  disabled: boolean;
  members?: Member[];
  onFileUpload?: (_file: File) => void;
  isUploading?: boolean;
  onSlashCommand?: (_command: string, _args: string) => void;
  /** Called when mentions list changes (for the parent to build m.mentions on send) */
  onMentionsChange?: (_mentions: MentionEntry[]) => void;
  /** Active edit session (ArrowUp on an empty composer); Enter submits, Esc cancels */
  editSession?: ComposerEditSession | null;
  onSubmitEdit?: (_text: string) => void;
  onCancelEdit?: () => void;
  /** Called when ArrowUp is pressed on an empty composer (edit my last message) */
  onRequestEditLast?: () => void;
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  isSending,
  sendError,
  placeholder,
  disabled,
  members = [],
  onFileUpload,
  isUploading = false,
  onSlashCommand,
  onMentionsChange,
  editSession = null,
  onSubmitEdit,
  onCancelEdit,
  onRequestEditLast,
}: ChatComposerProps) {
  // Track @mentions that were inserted
  const [mentions, setMentions] = useState<MentionEntry[]>([]);
  // Expose mentions to parent whenever they change
  useEffect(() => {
    onMentionsChange?.(mentions);
  }, [mentions, onMentionsChange]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Menu state
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [menuSelectedIdx, setMenuSelectedIdx] = useState(0);
  // Cursor position tracked via events (inputRef must not be read during render)
  const [cursorPos, setCursorPos] = useState<number | null>(null);

  // @ mention: detect @ trigger
  const mentionTrigger = useMemo(() => {
    const pos = cursorPos ?? value.length;
    const textBefore = value.slice(0, pos);
    // Find last @ that's either at start or after whitespace
    const atIndex = textBefore.lastIndexOf('@');
    if (atIndex === -1) return null;
    // Check that @ is at start or preceded by whitespace
    if (atIndex > 0 && !/\s/.test(textBefore[atIndex - 1])) return null;
    const query = textBefore.slice(atIndex + 1);
    // Don't trigger if there's a space right after @ with no query
    return { atIndex, query };
  }, [value, cursorPos]);

  // / command: detect / trigger at line start
  const commandTrigger = useMemo(() => {
    if (!value.startsWith('/')) return null;
    const query = value.slice(1);
    // Don't trigger if there's already a space-separated command with args
    return { query };
  }, [value]);

  // :emoji: trigger — last ':' preceded by whitespace/line start, short-code-ish query
  const emojiTrigger = useMemo(() => {
    const pos = cursorPos ?? value.length;
    const textBefore = value.slice(0, pos);
    const colonIndex = textBefore.lastIndexOf(':');
    if (colonIndex <= 0) return null;
    if (!/\s/.test(textBefore[colonIndex - 1])) return null;
    const query = textBefore.slice(colonIndex + 1);
    if (!/^[a-z0-9_+-]*$/i.test(query)) return null;
    return { colonIndex, query };
  }, [value, cursorPos]);

  // Filtered emoji for : trigger
  const filteredEmoji = useMemo(() => {
    if (!emojiTrigger) return [];
    return filterEmoji(emojiTrigger.query);
  }, [emojiTrigger]);

  // Filtered members for @ mention
  const filteredMembers = useMemo(() => {
    if (!mentionTrigger) return [];
    const q = mentionTrigger.query.toLowerCase();
    return members
      .filter(
        (m) =>
          m.displayName.toLowerCase().includes(q) ||
          m.userId.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [members, mentionTrigger]);

  // Filtered commands for / trigger
  const filteredCommands = useMemo(() => {
    if (!commandTrigger) return [];
    const q = commandTrigger.query.toLowerCase();
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (c) => c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
    );
  }, [commandTrigger]);

  // Derive the active menu from the current triggers; once dismissed it stays
  // hidden until the user types again (see the textarea onChange handler)
  const derivedMenuType: 'mention' | 'command' | 'emoji' | null =
    mentionTrigger && filteredMembers.length > 0
      ? 'mention'
      : emojiTrigger && filteredEmoji.length > 0
        ? 'emoji'
        : commandTrigger && filteredCommands.length > 0 && value.startsWith('/')
          ? 'command'
          : null;
  const menuType = menuDismissed ? null : derivedMenuType;
  const menuItems = menuType === 'mention'
    ? filteredMembers.length
    : menuType === 'emoji'
      ? filteredEmoji.length
      : filteredCommands.length;

  // Close menu on click outside
  useEffect(() => {
    if (!menuType) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuDismissed(true);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuType]);

  const handleSend = () => {
    if (!value.trim() || isSending) return;
    onSend();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Menu navigation
    if (menuType) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMenuSelectedIdx((prev) => (prev + 1) % menuItems);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMenuSelectedIdx((prev) => (prev - 1 + menuItems) % menuItems);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        if (menuType === 'mention') {
          insertMention(filteredMembers[menuSelectedIdx]);
        } else if (menuType === 'emoji') {
          insertEmoji(filteredEmoji[menuSelectedIdx].char);
        } else {
          selectCommand(filteredCommands[menuSelectedIdx]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuDismissed(true);
        return;
      }
    }

    // Edit session (element-web ArrowUp flow): Esc cancels, Enter saves
    if (editSession) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancelEdit?.();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (value.trim()) onSubmitEdit?.(value);
        return;
      }
    } else if (e.key === 'ArrowUp' && !value && e.currentTarget === e.target) {
      // Empty composer + ArrowUp → start editing my latest message
      e.preventDefault();
      onRequestEditLast?.();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Paste images/files straight to upload (AI-chat convention)
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length > 0 && onFileUpload && !disabled) {
      e.preventDefault();
      for (const file of files) onFileUpload(file);
    }
  };

  // Insert a :short_code: emoji at the detected ':' position
  const insertEmoji = useCallback(
    (char: string) => {
      const pos = inputRef.current?.selectionStart ?? value.length;
      const textBefore = value.slice(0, pos);
      const colonIndex = textBefore.lastIndexOf(':');
      if (colonIndex === -1) return;
      const before = value.slice(0, colonIndex);
      const after = value.slice(pos);
      const newValue = `${before}${char} ${after}`;
      onChange(newValue);
      setMenuDismissed(true);
      requestAnimationFrame(() => {
        if (inputRef.current) {
          const newPos = colonIndex + char.length + 1;
          inputRef.current.focus();
          inputRef.current.setSelectionRange(newPos, newPos);
        }
      });
    },
    [value, onChange]
  );

  const insertMention = useCallback(
    (member: Member) => {
      const cursorPos = inputRef.current?.selectionStart ?? value.length;
      const textBefore = value.slice(0, cursorPos);
      const atIndex = textBefore.lastIndexOf('@');
      if (atIndex === -1) return;
      const before = value.slice(0, atIndex);
      const after = value.slice(cursorPos);
      const placeholder = `@${member.displayName}`;
      const newValue = `${before}${placeholder} ${after}`;
      onChange(newValue);
      // Track this mention for Matrix m.mentions protocol
      setMentions((prev) => [...prev, { userId: member.userId, displayName: member.displayName, placeholder }]);
      setMenuDismissed(true);
      // Focus and set cursor after the mention
      requestAnimationFrame(() => {
        if (inputRef.current) {
          const newPos = atIndex + placeholder.length + 1;
          inputRef.current.focus();
          inputRef.current.setSelectionRange(newPos, newPos);
        }
      });
    },
    [value, onChange]
  );

  const selectCommand = useCallback(
    (command: SlashCommand) => {
      if (command.id === 'clear') {
        onChange('');
        setMenuDismissed(true);
        return;
      }
      if (command.id === 'members' || command.id === 'help') {
        // Execute immediately
        onSlashCommand?.(command.id, '');
        onChange('');
        setMenuDismissed(true);
        return;
      }
      // For commands with args (like /topic), fill in the command prefix
      onChange(command.label + ' ');
      setMenuDismissed(true);
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          const pos = (command.label + ' ').length;
          inputRef.current.setSelectionRange(pos, pos);
        }
      });
    },
    [onChange, onSlashCommand]
  );

  const autoResize = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 120) + 'px';
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0 && onFileUpload) {
      for (const file of files) onFileUpload(file);
    }
    // Reset input so the same files can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="border-t border-border px-3 py-2 shrink-0 bg-card/20 relative">
      {/* Edit session bar (element-web style) */}
      {editSession && (
        <div className="flex items-center gap-2 px-3 py-1.5 mb-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
          <Pencil className="w-3 h-3 shrink-0" />
          <span className="shrink-0 font-medium">编辑消息:</span>
          <span className="truncate flex-1">{editSession.initialText.slice(0, 60)}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 shrink-0 text-amber-600 hover:text-amber-700"
            onClick={onCancelEdit}
            title="取消编辑 (Esc)"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}

      {/* Autocomplete dropdown */}
      {menuType && (
        <div
          ref={dropdownRef}
          className="absolute bottom-full left-3 right-3 mb-1 bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto custom-scrollbar z-50"
        >
          {menuType === 'mention' &&
            filteredMembers.map((member, idx) => {
              const color = getAvatarColor(member.userId);
              return (
                <button
                  key={member.userId}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent transition-colors ${
                    idx === menuSelectedIdx ? 'bg-accent' : ''
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(member);
                  }}
                  onMouseEnter={() => setMenuSelectedIdx(idx)}
                >
                  <Avatar className="w-5 h-5 shrink-0">
                    <AvatarFallback className={`text-[8px] ${color}`}>
                      {member.displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{member.displayName}</p>
                    <p className="text-[10px] text-muted-foreground font-mono truncate">{member.userId}</p>
                  </div>
                </button>
              );
            })}
          {menuType === 'emoji' &&
            filteredEmoji.map((entry, idx) => (
              <button
                key={entry.name}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent transition-colors ${
                  idx === menuSelectedIdx ? 'bg-accent' : ''
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertEmoji(entry.char);
                }}
                onMouseEnter={() => setMenuSelectedIdx(idx)}
              >
                <span className="text-base leading-none shrink-0 w-6 text-center">{entry.char}</span>
                <div className="min-w-0">
                  <p className="text-xs font-mono truncate">:{entry.name}:</p>
                  <p className="text-[10px] text-muted-foreground truncate">{entry.keywords}</p>
                </div>
              </button>
            ))}
          {menuType === 'command' &&
            filteredCommands.map((cmd, idx) => (
              <button
                key={cmd.id}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent transition-colors ${
                  idx === menuSelectedIdx ? 'bg-accent' : ''
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectCommand(cmd);
                }}
                onMouseEnter={() => setMenuSelectedIdx(idx)}
              >
                <span className="text-muted-foreground shrink-0">{cmd.icon}</span>
                <div className="min-w-0">
                  <p className="text-xs font-medium">{cmd.label}</p>
                  <p className="text-[10px] text-muted-foreground">{cmd.description}</p>
                </div>
              </button>
            ))}
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2">
        {/* File upload button */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
          multiple
          accept="image/*,.pdf,.doc,.docx,.txt,.zip,.json,.csv"
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={handleFileClick}
          disabled={disabled || isUploading}
          title="上传文件（也可直接粘贴或拖拽）"
        >
          {isUploading ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Paperclip className="w-4 h-4" />
          )}
        </Button>

        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setCursorPos(e.target.selectionStart);
            setMenuDismissed(false);
            setMenuSelectedIdx(0);
            onChange(e.target.value);
          }}
          onSelect={(e) => setCursorPos(e.currentTarget.selectionStart)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={editSession ? '编辑消息... (Enter 保存, Esc 取消)' : placeholder}
          disabled={disabled}
          className="flex-1 resize-none rounded-lg border border-border bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50 min-h-[36px] max-h-[120px] placeholder:text-muted-foreground/50"
          rows={1}
          style={{ height: 'auto', overflow: 'hidden' }}
          onInput={autoResize}
        />
        {editSession ? (
          <Button
            size="sm"
            className="h-9 w-9 p-0 shrink-0"
            onClick={() => value.trim() && onSubmitEdit?.(value)}
            disabled={!value.trim() || isSending}
            title="保存编辑 (Enter)"
          >
            <Pencil className="w-4 h-4" />
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-9 w-9 p-0 shrink-0"
            onClick={handleSend}
            disabled={!value.trim() || isSending}
          >
            {isSending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 mt-0.5 min-h-[14px]">
        {sendError ? (
          <p className="text-red-500 text-[10px] truncate">发送失败: {sendError}</p>
        ) : (
          <span />
        )}
        <p className="text-[10px] text-muted-foreground/60 shrink-0">
          Enter 发送 · Shift+Enter 换行 · ↑ 编辑上一条 · @ 提及 · : 表情 · / 命令
        </p>
      </div>
    </div>
  );
}
