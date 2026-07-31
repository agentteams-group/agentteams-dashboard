'use client';

import { useState, useRef, useEffect } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { HelpContent } from '@/lib/help-content';

interface ContextualHelpPopoverProps {
  content: HelpContent;
  triggerClassName?: string;
}

export function ContextualHelpPopover({ content, triggerClassName }: ContextualHelpPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        className={`h-8 w-8 p-0 rounded-full ${triggerClassName}`}
        onClick={() => setOpen((v) => !v)}
        title="帮助"
      >
        <HelpCircle className="h-4 w-4 text-muted-foreground" />
      </Button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 z-50 top-full mt-2 w-72 rounded-lg border border-border/60 bg-popover text-popover-foreground shadow-lg p-3 text-sm"
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className="font-semibold text-sm">关于此页面</span>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-muted-foreground mb-2">{content.purpose}</p>
          <ul className="space-y-1 mb-3">
            {content.keyActions.map((action, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs">
                <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                {action}
              </li>
            ))}
          </ul>
          {content.docsLink && (
            <a
              href={content.docsLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-emerald-500 hover:underline"
            >
              {content.docsLabel ?? '查看文档'} &rarr;
            </a>
          )}
        </div>
      )}
    </div>
  );
}
