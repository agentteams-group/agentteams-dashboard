'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useModels } from '@/hooks/use-agentteams-models';

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
  const { data: providers, isLoading } = useModels();

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled || isLoading}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {providers?.map((provider) => (
          <SelectItem key={provider.name} value={provider.name}>
            {provider.name}
            <span className="ml-2 text-[10px] text-muted-foreground">
              ({provider.type})
            </span>
          </SelectItem>
        ))}
        {providers?.length === 0 && (
          <SelectItem value="__empty__" disabled>
            暂无模型配置，请先添加 AI 提供商
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
