'use client';

import { Input } from '@/components/ui/input';

interface ModelSelectorProps {
  value?: string;
  onChange: (_value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ModelSelector({
  value,
  onChange,
  placeholder = '选择模型',
  disabled,
}: ModelSelectorProps) {
  return (
    <Input
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      aria-label="请求模型别名"
    />
  );
}
