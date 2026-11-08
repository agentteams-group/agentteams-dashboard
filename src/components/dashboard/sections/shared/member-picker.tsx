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
}: {
  options: MemberPickerOption[];
  selected: string[];
  onAdd: (_value: string) => void;
  onRemove: (_value: string) => void;
  placeholder?: string;
}) {
  const remaining = options.filter((option) => !selected.includes(option.value));
  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((name) => (
            <span
              key={name}
              className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs sm:min-h-6"
            >
              <span className="min-w-0 truncate">{name}</span>
              <button
                type="button"
                aria-label={`移除 ${name}`}
                onClick={() => onRemove(name)}
                className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 sm:size-4"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {remaining.length > 0 ? (
        <Select key={selected.length} onValueChange={onAdd}>
          <SelectTrigger className="w-full">
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
          {selected.length > 0
            ? '已无其他可选成员'
            : '暂无可选成员（先到 Worker 列表创建）'}
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
