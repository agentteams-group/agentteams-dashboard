'use client';

import { useRef, useState, type ComponentProps } from 'react';
import { Check } from 'lucide-react';
import { isDesktopHover, useHoverOpen } from '@/lib/desktop-interactions';
import { Popover, PopoverAnchor, PopoverContent } from './popover';

// Preserve native form, keyboard and touch behavior while adding a desktop
// hover picker. Values still flow through the original select change event.
export function NativeSelect({ ref, onPointerEnter, onPointerLeave, onPointerDown, onKeyDown, ...props }: ComponentProps<'select'>) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const hover = useHoverOpen({});
  const [options, setOptions] = useState<{ value: string; label: string; disabled: boolean; selected: boolean; group: string }[]>([]);

  return <Popover open={hover.open} onOpenChange={hover.setOpen}>
    <PopoverAnchor asChild>
      <select {...props} data-slot="select-trigger" ref={element => { selectRef.current = element; if (typeof ref === 'function') ref(element); else if (ref) ref.current = element; }}
        {...hover.triggerProps}
        onPointerEnter={event => {
          onPointerEnter?.(event);
          if (event.defaultPrevented || props.disabled || !isDesktopHover(event)) return;
          setOptions(Array.from(event.currentTarget.options).filter(option => !option.hidden).map(option => ({ value: option.value, label: option.label, disabled: option.disabled || option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled, selected: option.selected, group: option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : '' })));
          hover.triggerProps.onPointerEnter(event);
        }}
        onPointerLeave={event => { onPointerLeave?.(event); hover.triggerProps.onPointerLeave(event); }}
        onPointerDown={event => { onPointerDown?.(event); if (!event.defaultPrevented && hover.open && isDesktopHover(event)) { event.preventDefault(); event.currentTarget.focus(); } }}
        onKeyDown={event => { onKeyDown?.(event); if (event.key === 'Escape') hover.setOpen(false); }} />
    </PopoverAnchor>
    <PopoverContent align="start" sideOffset={4} className="w-[var(--radix-popover-trigger-width)] min-w-40 overflow-hidden rounded-lg p-1 text-sm" {...hover.contentProps} onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={hover.preserveFocus}>
      <div role="listbox" aria-label={props['aria-label'] || '选择选项'} className="max-h-64 overflow-y-auto">
        {options.map((option, index) => <div key={index}>
          {option.group && option.group !== options[index - 1]?.group && <p className="px-2 py-1.5 text-xs text-muted-foreground">{option.group}</p>}
          <button type="button" role="option" aria-selected={option.selected} disabled={option.disabled} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50" onClick={() => {
            const select = selectRef.current;
            if (!select) return;
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            hover.setOpen(false);
            select.focus({ preventScroll: true });
          }}><span className="min-w-0 flex-1">{option.label}</span>{option.selected && <Check className="size-3.5 shrink-0" />}</button>
        </div>)}
      </div>
    </PopoverContent>
  </Popover>;
}
