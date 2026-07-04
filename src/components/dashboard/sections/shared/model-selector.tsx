'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useModels } from '@/hooks/use-hiclaw-models';

interface ModelSelectorProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ModelSelector({
  value,
  onChange,
  placeholder = '选择模型',
  disabled,
}: ModelSelectorProps) {
  const { data: models, isLoading } = useModels();

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled || isLoading}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {models?.map((model) => (
          <SelectItem key={model.name} value={model.name}>
            {model.name}
            {model.default && (
              <span className="ml-2 text-[10px] text-muted-foreground">(默认)</span>
            )}
          </SelectItem>
        ))}
        {models?.length === 0 && (
          <SelectItem value="__empty__" disabled>
            暂无模型配置
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
