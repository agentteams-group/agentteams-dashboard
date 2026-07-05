'use client';

import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { RefreshCw, Send, Paperclip, Wrench, HelpCircle, Trash2, Users, Hash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { getAvatarColor } from './format';

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
  const [menuType, setMenuType] = useState<'mention' | 'command' | null>(null);
  const [menuFilter, setMenuFilter] = useState('');
  const [menuSelectedIdx, setMenuSelectedIdx] = useState(0);

  // @ mention: detect @ trigger
  const mentionTrigger = useMemo(() => {
    const cursorPos = inputRef.current?.selectionStart ?? value.length;
    const textBefore = value.slice(0, cursorPos);
    // Find last @ that's either at start or after whitespace
    const atIndex = textBefore.lastIndexOf('@');
    if (atIndex === -1) return null;
    // Check that @ is at start or preceded by whitespace
    if (atIndex > 0 && !/\s/.test(textBefore[atIndex - 1])) return null;
    const query = textBefore.slice(atIndex + 1);
    // Don't trigger if there's a space right after @ with no query
    return { atIndex, query };
  }, [value]);

  // / command: detect / trigger at line start
  const commandTrigger = useMemo(() => {
    if (!value.startsWith('/')) return null;
    const query = value.slice(1);
    // Don't trigger if there's already a space-separated command with args
    return { query };
  }, [value]);

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

  // Update menu state based on triggers
  useEffect(() => {
    if (mentionTrigger && filteredMembers.length > 0) {
      setMenuType('mention');
      setMenuFilter(mentionTrigger.query);
      setMenuSelectedIdx(0);
    } else if (commandTrigger && filteredCommands.length > 0 && value.startsWith('/')) {
      setMenuType('command');
      setMenuFilter(commandTrigger.query);
      setMenuSelectedIdx(0);
    } else {
      setMenuType(null);
    }
  }, [mentionTrigger, commandTrigger, filteredMembers.length, filteredCommands.length, value]);

  // Close menu on click outside
  useEffect(() => {
    if (!menuType) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuType(null);
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
      const items = menuType === 'mention' ? filteredMembers : filteredCommands;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMenuSelectedIdx((prev) => (prev + 1) % items.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMenuSelectedIdx((prev) => (prev - 1 + items.length) % items.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        if (menuType === 'mention') {
          insertMention(filteredMembers[menuSelectedIdx]);
        } else {
          selectCommand(filteredCommands[menuSelectedIdx]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuType(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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
      setMenuType(null);
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
        setMenuType(null);
        return;
      }
      if (command.id === 'members' || command.id === 'help') {
        // Execute immediately
        onSlashCommand?.(command.id, '');
        onChange('');
        setMenuType(null);
        return;
      }
      // For commands with args (like /topic), fill in the command prefix
      onChange(command.label + ' ');
      setMenuType(null);
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
    const file = e.target.files?.[0];
    if (file && onFileUpload) {
      onFileUpload(file);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="border-t border-border px-3 py-2 shrink-0 bg-card/20 relative">
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
          accept="image/*,.pdf,.doc,.docx,.txt,.zip,.json,.csv"
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={handleFileClick}
          disabled={disabled || isUploading}
          title="上传文件"
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
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 resize-none rounded-lg border border-border bg-background/50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-500/50 min-h-[36px] max-h-[120px] placeholder:text-muted-foreground/50"
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
