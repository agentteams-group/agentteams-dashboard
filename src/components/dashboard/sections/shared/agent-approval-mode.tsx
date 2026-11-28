'use client';

import { useId } from 'react';

export function AgentApprovalMode({ value, disabled, onChange }: {
  value?: 'ask' | 'allow';
  disabled?: boolean;
  onChange: (_value: 'ask' | 'allow') => void;
}) {
  const name = useId();
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">工具审批</legend>
      <div className="flex gap-4 text-sm">
        {([['ask', '请求审批'], ['allow', '自动通过']] as const).map(([mode, label]) => (
          <label key={mode} className="flex items-center gap-2">
            <input type="radio" name={name} value={mode} checked={value === mode} onChange={() => onChange(mode)} />
            {label}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {value ? '保存后重启 Agent 生效；执行权限保持原有设置。' : '尚未设置，当前保持运行时已有的审批配置。'}
      </p>
    </fieldset>
  );
}
