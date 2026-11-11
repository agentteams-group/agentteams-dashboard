'use client';

import { X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface MemberPickerOption {
  value: string;
  label: string;
}

/**
 * 成员名单编辑器（对齐插件 antd Select mode="multiple" 交互）：已选成员
 * 渲染为可删除的 chip，Select 只提供"存在且未选"的名字——从界面上根本
 * 输不出不存在的名字（悬空引用在输入层即不可能）。
 *
 * key={selected.length}：每次增删后重挂载 Select，让触发器回到占位符
 * 状态（已选内容以 chip 呈现，不重复占用触发器）。
 */
export function MemberPicker({
  options,
  selected,
  onAdd,
  onRemove,
  placeholder = '选择成员添加…',
  disabled = false,
  loading = false,
  emptyHint,
  allSelectedHint,
  invalidValues,
  triggerId,
  triggerLabel,
}: {
  options: MemberPickerOption[];
  selected: string[];
  onAdd: (_value: string) => void;
  onRemove: (_value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** 候选还在加载：不渲染选择器，避免"空列表 = 没有成员"的误读。 */
  loading?: boolean;
  /** 没有可选项且没有任何已选时的说明。 */
  emptyHint?: string;
  /** 候选已全部被选中时的说明。 */
  allSelectedHint?: string;
  /** 仍保留但已不在候选里的值（悬空引用）——红色 chip 标记。 */
  invalidValues?: string[];
  triggerId?: string;
  triggerLabel?: string;
}) {
  // 展示层去重：上游数据偶发重复时不会渲染两个同名 chip。
  const selectedValues = [...new Set(selected)];
  const invalid = new Set(invalidValues ?? []);
  const remaining = [
    ...new Map(
      options
        .filter((option) => !selectedValues.includes(option.value))
        .map((option) => [option.value, option]),
    ).values(),
  ];
  return (
    <div className="space-y-2">
      {selectedValues.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedValues.map((name) => (
            <span
              key={name}
              data-invalid={invalid.has(name) || undefined}
              title={invalid.has(name) ? '该团队不存在或不可用' : undefined}
              className={`inline-flex min-h-11 max-w-full items-center gap-1 rounded-md border bg-muted/50 px-2 py-0.5 text-xs sm:min-h-6 ${
                invalid.has(name) ? 'border-destructive/50 text-destructive' : 'border-border'
              }`}
            >
              <span className="min-w-0 truncate">{name}</span>
              <button
                type="button"
                aria-label={`移除 ${name}`}
                onClick={() => onRemove(name)}
                disabled={disabled}
                className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 sm:size-4"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {loading ? (
        <p role="status" className="text-xs text-muted-foreground">
          加载中…
        </p>
      ) : remaining.length > 0 ? (
        <Select key={selectedValues.length} onValueChange={onAdd} disabled={disabled}>
          <SelectTrigger id={triggerId} className="w-full" aria-label={triggerLabel}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {remaining.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-xs text-muted-foreground">
          {selectedValues.length > 0
            ? (allSelectedHint ?? '已无其他可选成员')
            : (emptyHint ?? '暂无可选成员（先到 Worker 列表创建）')}
        </p>
      )}
    </div>
  );
}

/** Worker 选项标签（对齐插件 workerOptionLabel：名字 + 现况；
 *  dashboard WorkerResponse 无 team 字段，只拼模型）。 */
export function workerPickerLabel(
  name: string,
  model?: string | null,
): string {
  return model?.trim() ? `${name}（${model.trim()}）` : name;
}
