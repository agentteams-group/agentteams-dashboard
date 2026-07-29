'use client';

import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/lib/use-copy-to-clipboard';

interface CopyButtonProps {
  text: string;
  className?: string;
  label?: string;
  successLabel?: string;
  disabled?: boolean;
}

export function CopyButton({ text, className, label = '复制', successLabel = '已复制', disabled = false }: CopyButtonProps) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <Button
      variant="ghost"
      size="sm"
      className={`h-6 w-6 p-0 ${className || ''}`}
      onClick={() => copy(text)}
      title={copied ? successLabel : label}
      aria-label={copied ? successLabel : label}
      disabled={disabled}
    >
      {copied ? <Check className="w-3 h-3 text-emerald-500" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
    </Button>
  );
}
