'use client';

// 「先 Provider，再 Model」的唯一模型选择实现（对齐工作台插件 ModelPicker）。
//
// 不变量：
//   1. 控件顺序恒为 Provider → Model；
//   2. Model 候选 = 所选 Provider 承载的 alias；Provider 为空/哨兵 = 全量；
//   3. 换 Provider 后，旧 Model 不属于新 Provider → 清空（不悄悄保留）；
//   4. 当前 Model 不在候选里仍原样显示并保留在列表中（未知值不丢）。
//
// 两个框都复用项目已有的 Combobox（可搜索 + 可自由输入），不另造选择器。

import { useId } from 'react';
import { Combobox } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';

/** 「无 Provider（在服 + 在用）」哨兵：UI 展示为无 provider（= 跟随默认/全量）。 */
export const LOCAL_PROVIDER = '无 Provider（在服 + 在用）';

export interface ModelPickerProps {
  /** 网关 provider 名（来自 buildModelCandidateCatalog(...).providers）。 */
  providers: string[];
  /** 真实 provider；空串 = 不绑定 provider。 */
  provider: string;
  model: string;
  modelsByProvider: Record<string, string[]>;
  allModels: string[];
  onChange: (_provider: string, _model: string) => void;
  localProviderLabel?: string;
  disabled?: boolean;
  providerLabel?: string;
  modelLabel?: string;
  providerPlaceholder?: string;
  modelPlaceholder?: string;
  providerAriaLabel?: string;
  modelAriaLabel?: string;
}

/** 所选 provider 的模型候选；空 provider / 未声明模型表 → 全量。 */
export function modelOptionsForProvider(
  modelsByProvider: Record<string, string[]>,
  allModels: string[],
  provider: string,
): string[] {
  const key = provider.trim();
  if (!key) return allModels;
  const mapped = modelsByProvider[key];
  return mapped && mapped.length > 0 ? mapped : allModels;
}

/** 换 provider 后应保留的 model：不属于新候选 → 清空。 */
export function keepModelForProvider(
  modelsByProvider: Record<string, string[]>,
  allModels: string[],
  provider: string,
  model: string,
): string {
  if (!model) return '';
  return modelOptionsForProvider(modelsByProvider, allModels, provider).includes(model)
    ? model
    : '';
}

export function ModelPicker({
  providers,
  provider,
  model,
  modelsByProvider,
  allModels,
  onChange,
  localProviderLabel = LOCAL_PROVIDER,
  disabled,
  providerLabel = 'Provider',
  modelLabel = '请求模型别名',
  providerPlaceholder = '选择或输入 Provider',
  modelPlaceholder = '选择或输入模型',
  providerAriaLabel = 'Provider',
  modelAriaLabel = '请求模型别名',
}: ModelPickerProps) {
  const providerId = useId();
  const modelId = useId();

  const currentProvider = provider.trim();
  // 空 provider 在 UI 上显示为哨兵，写回时再还原为空串。
  const providerDisplay = currentProvider || localProviderLabel;
  const providerOptions = [
    localProviderLabel,
    ...providers.filter((item) => item !== localProviderLabel),
    // 当前值不在目录里也要能看见并保留（可自由输入的 provider）。
    ...(currentProvider &&
    currentProvider !== localProviderLabel &&
    !providers.includes(currentProvider)
      ? [currentProvider]
      : []),
  ];

  const modelCandidates = modelOptionsForProvider(
    modelsByProvider,
    allModels,
    currentProvider,
  );
  const modelOptions =
    model && !modelCandidates.includes(model)
      ? [model, ...modelCandidates]
      : modelCandidates;

  const handleProviderChange = (next: string) => {
    const real = next.trim() === localProviderLabel ? '' : next.trim();
    onChange(real, keepModelForProvider(modelsByProvider, allModels, real, model));
  };

  return (
    <div className="min-w-0 space-y-2">
      <div className="min-w-0 space-y-1">
        <Label htmlFor={providerId}>{providerLabel}</Label>
        <Combobox
          id={providerId}
          className="w-full min-w-0"
          value={providerDisplay}
          options={providerOptions}
          onChange={handleProviderChange}
          placeholder={providerPlaceholder}
          disabled={disabled}
          ariaLabel={providerAriaLabel}
        />
      </div>
      <div className="min-w-0 space-y-1">
        <Label htmlFor={modelId}>{modelLabel}</Label>
        <Combobox
          id={modelId}
          className="w-full min-w-0"
          value={model}
          options={modelOptions}
          onChange={(next) => onChange(currentProvider, next)}
          placeholder={modelPlaceholder}
          disabled={disabled}
          ariaLabel={modelAriaLabel}
        />
      </div>
    </div>
  );
}
