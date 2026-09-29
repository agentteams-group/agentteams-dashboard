'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useModelSelection } from '@/hooks/use-model-selection';

// ────────────────────────────────────────────
// Diagnosis model selector
// ────────────────────────────────────────────

const DEFAULT_MODEL_VALUE = '__server_default__';
const CUSTOM_MODEL_VALUE = '__custom__';

export function DiagnosisModelSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (_value: string) => void;
  disabled?: boolean;
}) {
  const { options, sessionIssue } = useModelSelection();
  // F9②/F10：sessionIssue = Higress 模型数据加载失败（Console 会话失效/不可达）
  const configured = options.filter((o) => o.kind === 'configured');
  const builtin = options.filter((o) => o.kind === 'builtin');
  const [customMode, setCustomMode] = useState(false);

  // Leave custom mode once the external value resolves to a selectable alias
  // (adjust state during render, per React guidance).
  if (customMode && value && options.some((o) => o.alias === value)) {
    setCustomMode(false);
  }

  const known = options.some((o) => o.alias === value);
  const customActive = customMode || (value !== '' && !known);
  const selectedOption = options.find((o) => o.alias === value);

  if (customActive) {
    return (
      <div className="space-y-1.5">
        <div className="flex gap-2">
          <Input
            className="flex-1"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="自定义模型别名，经 AI 网关路由"
            disabled={disabled}
            aria-label="诊断模型别名"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={disabled}
            onClick={() => {
              setCustomMode(false);
              onChange('');
            }}
          >
            从列表选择
          </Button>
        </div>
        {sessionIssue && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-600 break-words">
            模型别名组暂不可用：{sessionIssue}。默认模型与自定义输入仍可使用；以管理员凭据重新登录（Higress Console 轨）后重试即可恢复。
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Select
        value={value === '' ? DEFAULT_MODEL_VALUE : value}
        onValueChange={(next) => {
          if (next === CUSTOM_MODEL_VALUE) {
            setCustomMode(true);
            onChange('');
          } else if (next === DEFAULT_MODEL_VALUE) {
            onChange('');
          } else {
            onChange(next);
          }
        }}
        disabled={disabled}
      >
        <SelectTrigger className="w-full" aria-label="诊断模型">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-w-[min(100vw-2rem,28rem)]">
          <SelectItem value={DEFAULT_MODEL_VALUE}>
            <span className="flex flex-col">
              <span className="font-medium">默认模型</span>
              <span className="text-xs text-muted-foreground">
                服务器配置（AGENTTEAMS_DEFAULT_MODEL），经 AI 网关调用
              </span>
            </span>
          </SelectItem>
          {configured.length > 0 && (
            <SelectGroup>
              <SelectLabel>已配置的服务商模型</SelectLabel>
              {configured.map((option) => (
                <SelectItem key={option.alias} value={option.alias}>
                  <span className="flex flex-col">
                    <span className="font-mono">{option.alias}</span>
                    <span className="text-xs text-muted-foreground">
                      {option.binding
                        ? `${option.binding.routeName} → ${option.binding.providerName} / ${option.binding.targetModel}`
                        : ''}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {builtin.length > 0 && (
            <SelectGroup>
              <SelectLabel>内置别名（需配置路由）</SelectLabel>
              {builtin.map((option) => (
                <SelectItem key={option.alias} value={option.alias}>
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono">{option.alias}</span>
                    <Badge variant="secondary" className="text-[9px]">内置</Badge>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          <SelectSeparator />
          <SelectItem value={CUSTOM_MODEL_VALUE}>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              自定义别名…
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
      {value === '' ? (
        <p className="text-xs text-muted-foreground">
          使用服务器端默认模型执行诊断；可在「模型管理」添加服务商模型后在此选择。
        </p>
      ) : selectedOption?.kind === 'configured' && selectedOption.binding ? (
        <p className="text-xs text-muted-foreground">
          经路由 {selectedOption.binding.routeName} 转发至{' '}
          {selectedOption.binding.providerName} / {selectedOption.binding.targetModel}
        </p>
      ) : selectedOption?.kind === 'builtin' ? (
        <p className="text-xs text-amber-600/80">
          内置模型别名，需先在「模型管理」为其配置路由映射，否则调用可能失败。
        </p>
      ) : null}
      {sessionIssue && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-600 break-words">
          模型别名组暂不可用：{sessionIssue}。默认模型与自定义输入仍可使用；以管理员凭据重新登录（Higress Console 轨）后重试即可恢复。
        </p>
      )}
    </div>
  );
}
