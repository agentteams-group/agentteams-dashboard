'use client';

import { useId } from 'react';
import { Input } from '@/components/ui/input';
import type { AgentTeamsModelBinding } from '@/lib/model-bindings';

interface ModelSelectorProps {
  value?: string;
  onChange: (_value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  options?: AgentTeamsModelBinding[];
}

export function ModelSelector({
  value,
  onChange,
  placeholder = '选择模型',
  disabled,
  options,
}: ModelSelectorProps) {
  const listId = useId();
  const binding = options?.find((option) => option.requestModelAlias === value);
  const uniqueOptions = [...new Map((options ?? []).map((option) => [option.requestModelAlias, option])).values()];

  return (
    <div className="space-y-1.5">
      <Input
        list={uniqueOptions.length > 0 ? listId : undefined}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-label="请求模型别名"
      />
      {uniqueOptions.length > 0 && (
        <datalist id={listId}>
          {uniqueOptions.map((option) => (
            <option
              key={option.requestModelAlias}
              value={option.requestModelAlias}
              label={`${option.routeName} / ${option.providerName} / ${option.targetModel}`}
            />
          ))}
        </datalist>
      )}
      {binding ? (
        <p className="text-xs text-muted-foreground">
          通过路由 {binding.routeName} 转发至 {binding.providerName} / {binding.targetModel}
        </p>
      ) : uniqueOptions.length > 0 && value?.trim() ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          该别名将由通配符路由或服务端绑定校验处理。
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          在 AI 网关配置请求模型别名后，此处会提供可选项。
        </p>
      )}
    </div>
  );
}
