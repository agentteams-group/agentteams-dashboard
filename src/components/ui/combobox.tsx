'use client';

// 可搜索、可自由输入的 Combobox（Popover + Input + 候选列表）。
//
// 为什么不是 Select：模型授权 / CodingCLI 模型名 / provider 这些字段的候选
// 来自网关配置，配置缺失时必须还能手填（fail-open 的输入路径），纯 Select
// 会把用户锁死在空候选里。allowCustom 默认 true：键入即写回 value；回车/
// 失焦只负责收起（值已提交，不会丢）。allowCustom=false 时键入只用于过滤，
// 失焦回退到已选值。
//
// 无新依赖：Popover 走已有的 @radix-ui/react-popover，样式 token 与 Select 一致。

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface ComboboxProps {
  value: string;
  options: readonly string[];
  onChange: (_value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** false = 只能从候选里选（键入仅过滤）；默认 true = 允许自由输入。 */
  allowCustom?: boolean;
  id?: string;
  className?: string;
  inputClassName?: string;
  ariaLabel?: string;
  /** 无候选时的提示（allowCustom=false 才需要，true 时直接收起列表）。 */
  emptyText?: string;
}

export function Combobox({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  allowCustom = true,
  id,
  className,
  inputClassName,
  ariaLabel,
  emptyText = '无候选项',
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  // -1 = 未用方向键/悬停指定，回车按自由输入处理（不劫持用户手填的值）。
  const [active, setActive] = useState(-1);
  const [draft, setDraft] = useState<string | null>(null);
  const listId = useId();
  const listRef = useRef<HTMLUListElement | null>(null);

  const unique = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of options) {
      const item = raw.trim();
      if (!item || seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
    return out;
  }, [options]);

  const query = search.trim().toLowerCase();
  const filtered = query
    ? unique.filter((item) => item.toLowerCase().includes(query))
    : unique;
  const text = draft ?? value;
  const activeIndex = filtered.length > 0 && active >= 0 ? Math.min(active, filtered.length - 1) : -1;
  const showList = open && !disabled && (filtered.length > 0 || !allowCustom);

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const node = listRef.current.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, showList]);

  const close = () => {
    setOpen(false);
    setSearch('');
    setActive(-1);
    setDraft(null);
  };

  const choose = (next: string) => {
    onChange(next);
    close();
  };

  const openList = () => {
    setOpen(true);
    setSearch('');
    setActive(-1);
  };

  const handleInput = (next: string) => {
    setOpen(true);
    setSearch(next);
    setActive(-1);
    if (allowCustom) onChange(next);
    else setDraft(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setSearch('');
        setActive(0);
        return;
      }
      if (filtered.length === 0) return;
      setActive((prev) => (prev + 1 >= filtered.length ? 0 : prev + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setSearch('');
        setActive(filtered.length - 1);
        return;
      }
      if (filtered.length === 0) return;
      setActive((prev) => (prev - 1 < 0 ? filtered.length - 1 : prev - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (showList && activeIndex >= 0) {
        choose(filtered[activeIndex]);
        return;
      }
      // 自由输入：值已在键入时提交，回车只收起；不可自由输入时回退草稿。
      close();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') close();
  };

  return (
    <Popover
      open={showList}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <PopoverAnchor asChild>
        <div className={cn('relative w-full min-w-0', className)}>
          <Input
            id={id}
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={showList}
            aria-controls={showList ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              showList && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
            }
            autoComplete="off"
            value={text}
            placeholder={placeholder}
            disabled={disabled}
            className={cn('pr-8', inputClassName)}
            onChange={(event) => handleInput(event.target.value)}
            onFocus={() => {
              if (!disabled) openList();
            }}
            onBlur={close}
            onKeyDown={handleKeyDown}
          />
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="max-h-[min(50vh,260px)] w-[var(--radix-popper-anchor-width)] min-w-40 overflow-y-auto p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
      >
        <ul ref={listRef} id={listId} role="listbox" className="space-y-0.5">
          {filtered.map((item, index) => {
            const selected = item === value;
            return (
              <li
                key={item}
                id={`${listId}-option-${index}`}
                data-index={index}
                role="option"
                aria-selected={selected}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                  index === activeIndex && 'bg-accent text-accent-foreground',
                )}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(item)}
              >
                <span className="min-w-0 flex-1 truncate">{item}</span>
                {selected ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
              </li>
            );
          })}
          {filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">{emptyText}</li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
