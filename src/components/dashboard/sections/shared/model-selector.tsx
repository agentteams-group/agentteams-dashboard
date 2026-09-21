'use client';

import { useState } from 'react';
import { Cpu, Pencil, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import type { ModelSelectionOption } from '@/lib/model-catalog';

const CUSTOM_ALIAS = '__custom_alias__';

interface ModelSelectorProps {
  value?: string;
  onChange: (_value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  options?: ModelSelectionOption[];
  // F9②/F10：Higress 模型数据加载失败（Console 会话失效/不可达/未配置）时的
  // 显式原因 + 出路——不静默平铺（只显内置组而不说明 = 用户以为 alias 丢了）。
  sessionIssue?: string | null;
}

function SessionIssueNote({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-600 break-words">
      模型别名组暂不可用：{message}。内置模型与自定义输入仍可使用；以管理员
      凭据重新登录（Higress Console 轨）后重试即可恢复别名组。
    </p>
  );
}

export function ModelSelector({
  value,
  onChange,
  placeholder = '选择模型',
  disabled,
  options,
  sessionIssue,
}: ModelSelectorProps) {
  const uniqueOptions = [
    ...new Map((options ?? []).map((option) => [option.alias, option])).values(),
  ];
  // 分组对齐插件（可辨认性）：路由可解析的 alias 与需配路由的内置模板分开两组，
  // 组内按名称排序（buildModelSelectionOptions 已整体排序，filter 保序）。
  const configuredOptions = uniqueOptions.filter((option) => option.kind === 'configured');
  const builtinOptions = uniqueOptions.filter((option) => option.kind === 'builtin');
  const sglangOptions = uniqueOptions.filter((option) => option.kind === 'sglang');
  const known = uniqueOptions.some((option) => option.alias === value);
  const [customMode, setCustomMode] = useState(false);

  // Leave custom mode once the external value resolves to a selectable alias
  // (adjust state during render, per React guidance).
  if (customMode && value && known) {
    setCustomMode(false);
  }

  const selectedOption = uniqueOptions.find((option) => option.alias === value);
  const customActive = customMode || Boolean(value && !known);

  if (customActive) {
    return (
      <div className="space-y-1.5 min-w-0 w-full">
      <p className="text-xs text-muted-foreground">已配置别名仅表示存在模型映射，尚未验证该 Worker 的授权和调用结果。</p>
        <div className="flex gap-2 min-w-0">
          <Input
            className="min-w-0 flex-1"
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            aria-label="请求模型别名"
          />
          {uniqueOptions.length > 0 && (
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
          )}
        </div>
        <p className="text-xs text-muted-foreground break-words">
          自定义请求模型别名，将由通配符路由或服务端绑定校验处理。
        </p>
        {sessionIssue ? <SessionIssueNote message={sessionIssue} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-1.5 min-w-0 w-full">
      <p className="text-xs text-muted-foreground">已配置别名仅表示存在模型映射，尚未验证该 Worker 的授权和调用结果。</p>
      <Select
        value={value ?? ''}
        onValueChange={(next) => {
          if (next === CUSTOM_ALIAS) {
            setCustomMode(true);
            onChange('');
          } else {
            onChange(next);
          }
        }}
        disabled={disabled}
      >
        <SelectTrigger className="w-full min-w-0" aria-label="请求模型别名">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-w-[min(100vw-2rem,28rem)]">
          {configuredOptions.length > 0 && (
            <SelectGroup>
              <SelectLabel>Higress alias（路由可解析）</SelectLabel>
              {configuredOptions.map((option) => (
                <SelectItem key={option.alias} value={option.alias} className="min-w-0">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono truncate">{option.alias}</span>
                  </span>
                  {option.kind === 'configured' && option.binding ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {option.binding.routeName} / {option.binding.providerName} / {option.binding.targetModel}
                    </span>
                  ) : (
                    <span className="block truncate text-xs text-muted-foreground">
                      网关路由可解析
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {builtinOptions.length > 0 && (
            <SelectGroup>
              <SelectLabel>Higress 内置 alias（需配路由映射）</SelectLabel>
              {builtinOptions.map((option) => (
                <SelectItem key={option.alias} value={option.alias} className="min-w-0">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono truncate">{option.alias}</span>
                    <Badge variant="secondary" className="text-[11px] shrink-0">
                      <Sparkles className="mr-0.5 size-2.5" />
                      内置
                    </Badge>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    内置模型，需在「模型管理」配置路由映射
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {sglangOptions.length > 0 && (
            <SelectGroup>
              <SelectLabel>SGLang 在线模型</SelectLabel>
              {sglangOptions.map((option) => (
                <SelectItem key={option.alias} value={option.alias} className="min-w-0">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono truncate">{option.alias}</span>
                    <Badge variant="secondary" className="text-[11px] shrink-0">
                      <Cpu className="mr-0.5 size-2.5" />
                      SGLang
                    </Badge>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    SGLang 推理服务在线模型，经 AI 网关路由转发
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}

          {uniqueOptions.length > 0 && <SelectSeparator />}
          <SelectItem value={CUSTOM_ALIAS}>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Pencil className="size-3.5" />
              自定义别名
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
      {selectedOption?.kind === 'configured' && selectedOption.binding ? (
        <p className="text-xs text-muted-foreground break-words">
          通过路由 {selectedOption.binding.routeName} 转发至{' '}
          {selectedOption.binding.providerName} / {selectedOption.binding.targetModel}
        </p>
      ) : selectedOption?.kind === 'sglang' ? (
        <p className="text-xs text-muted-foreground break-words">
          SGLang 推理服务在线模型；请求按模型名经 AI 网关路由至本地推理服务。
        </p>
      ) : selectedOption?.kind === 'builtin' ? (
        <p className="text-xs text-amber-600/80 break-words">
          内置模型别名，请求经 AI 网关 Consumer 凭证转发；需先在「模型管理」为其配置路由映射。
        </p>
      ) : (
        <p className="text-xs text-muted-foreground break-words">
          {uniqueOptions.length === 0
            ? '在「模型管理」创建提供商并配置模型映射，保存后此处即可选择。或手动输入模型别名。'
            : '在「模型管理」配置模型别名后，此处会提供可选项。'}
        </p>
      )}
      {sessionIssue ? <SessionIssueNote message={sessionIssue} /> : null}
    </div>
  );
}
