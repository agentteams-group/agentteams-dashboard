'use client';

// LLM 调优字段的共享展示组件（#146 缺口 3）。Worker 面板与团队默认共用，
// 保证两处入口的字段顺序、单位、默认值提示与校验一致。

import { Input } from '@/components/ui/input';
import {
  LLM_TUNING_FIELDS,
  LLM_TUNING_GROUP_LABELS,
  validateLlmTuningValue,
  type LlmTuningGroup,
  type LlmTuningKey,
  type LlmTuningRecord,
} from '@/lib/llm-tuning';

const GROUP_ORDER: readonly LlmTuningGroup[] = ['startup', 'stream'];

export function LlmTuningFields({
  values,
  onChange,
  disabled,
  idPrefix,
}: {
  values: LlmTuningRecord;
  onChange: (_key: LlmTuningKey, _value: string) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  return (
    <div className="space-y-3">
      {GROUP_ORDER.map((group) => (
        <div key={group} className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {LLM_TUNING_GROUP_LABELS[group]}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {LLM_TUNING_FIELDS.filter((field) => field.group === group).map((field) => {
              const value = values[field.key];
              const invalid = validateLlmTuningValue(value) !== null;
              return (
                <label key={field.key} className="space-y-1">
                  <span className="text-xs text-muted-foreground">
                    {field.label}
                    {field.unit ? `（${field.unit}）` : ''}
                  </span>
                  <Input
                    id={`${idPrefix}-${field.key}`}
                    type="number"
                    min={0}
                    step="any"
                    disabled={disabled}
                    aria-invalid={invalid}
                    className="h-8 text-xs font-mono"
                    placeholder={field.registryDefault ? `默认 ${field.registryDefault}` : '默认'}
                    value={value}
                    onChange={(e) => onChange(field.key, e.target.value)}
                  />
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
