'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MemberPicker } from '@/components/dashboard/sections/shared/member-picker';

/**
 * Human「可访问团队」的候选来源（对齐工作台插件 ChipPicker：候选来自
 * Team CRD 列表，chips 呈现已选，只能从候选里添加）。
 *
 * isError / isLoading 必须传进来：团队列表读不到时不能假装"没有团队"
 * （那会把已有值当悬空引用、或让用户以为团队被删了）。
 */
export interface TeamCandidateSource {
  /** useTeams() 的团队名；加载失败时可能是上一次成功的数据（保留不动）。 */
  names: string[];
  isLoading?: boolean;
  isError?: boolean;
  /** 失败原因（403/404/网络，可选，仅用于可见说明）。 */
  errorMessage?: string;
  onRetry?: () => void;
}

export function uniqueTeamNames(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function TeamSourceNotice({
  source,
  retryLabel = '重试加载团队',
}: {
  source: TeamCandidateSource;
  retryLabel?: string;
}) {
  if (source.isError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
      >
        <span className="min-w-0 flex-1 break-words">
          团队列表加载失败
          {source.errorMessage ? `：${source.errorMessage}` : ''}
          ；已有团队保留不动，暂不能新增或校验团队。
        </span>
        {source.onRetry && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 shrink-0"
            onClick={source.onRetry}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {retryLabel}
          </Button>
        )}
      </div>
    );
  }
  if (source.isLoading) {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        团队列表加载中…
      </p>
    );
  }
  return null;
}

/**
 * 可访问团队字段：候选 chips 多选（无逗号手输），悬空团队名保留可见
 * 并给出明确移除动作，而不是静默丢弃。
 */
export function TeamAccessField({
  selected,
  source,
  onChange,
  disabled = false,
  triggerId,
  triggerLabel = '可访问团队',
}: {
  selected: string[];
  source: TeamCandidateSource;
  onChange: (_next: string[]) => void;
  disabled?: boolean;
  triggerId?: string;
  triggerLabel?: string;
}) {
  const selectedNames = uniqueTeamNames(selected);
  const candidateNames = uniqueTeamNames(source.names);
  // 加载中/失败时不判悬空：列表不完整不代表团队不存在。
  const unavailable =
    source.isLoading || source.isError
      ? []
      : selectedNames.filter((name) => !candidateNames.includes(name));

  const add = (name: string) => {
    if (selectedNames.includes(name)) return;
    onChange([...selectedNames, name]);
  };

  const emptyHint = source.isError
    ? '团队列表不可用，暂不能新增团队'
    : source.isLoading
      ? '团队列表加载中…'
      : '暂无可选团队（先在团队页创建）';

  return (
    <div className="space-y-2">
      {(source.isError || (source.isLoading && candidateNames.length > 0)) && (
        <TeamSourceNotice source={source} />
      )}
      <MemberPicker
        options={candidateNames.map((name) => ({ value: name, label: name }))}
        selected={selectedNames}
        invalidValues={unavailable}
        onAdd={add}
        onRemove={(name) => onChange(selectedNames.filter((item) => item !== name))}
        placeholder="选择团队添加…"
        emptyHint={emptyHint}
        allSelectedHint="已选全部可访问团队"
        loading={source.isLoading && candidateNames.length === 0}
        disabled={disabled}
        triggerId={triggerId}
        triggerLabel={triggerLabel}
      />
      {unavailable.length > 0 && (
        <div
          role="alert"
          className="space-y-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-2"
        >
          <p className="text-xs text-destructive">
            以下团队不存在或不可用：{unavailable.join('、')}
            （保留不会自动清除；保存会被服务端拒绝，请先移除）
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            disabled={disabled}
            onClick={() => onChange(selectedNames.filter((name) => !unavailable.includes(name)))}
          >
            移除不可用团队
          </Button>
        </div>
      )}
    </div>
  );
}
