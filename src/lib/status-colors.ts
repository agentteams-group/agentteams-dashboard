// Shared status/outcome badge palettes (UI-01): single source for the
// project views so projects-section and tasks-section cannot drift.
//
// 颜色单轨（方案 v3 A-1/A-2）：这里只写语义状态 token 的名字，不写具体颜色。
// 六个 token（--status-running/-waiting/-blocked/-done/-failed/-info）在
// `src/app/globals.css` 的 :root、.dark、.high-contrast 各定义一次，所以三套主题
// 自动同色，高对比主题不再被组件里写死的 `dark:` 分支绕过。
//
// 本文件必须保持纯数据（不含 hooks）：它被服务端组件 import，Next 不允许这条链上
// 出现 React hooks。要真色（图表 / canvas）用 `@/hooks/use-status-colors`。
import type { ProjectStatus } from '@/lib/agentteams-projects-api';
import type { BoardTask } from '@/hooks/use-task-board';
import { statusBadgeClass } from '@/lib/status-tokens';

export const PROJECT_STATUS_COLOR: Record<ProjectStatus, string> = {
  planning: statusBadgeClass('info'),
  active: statusBadgeClass('running'),
  paused: statusBadgeClass('waiting'),
  completed: statusBadgeClass('done'),
  // 未知状态不给颜色，给中性：它不是六种语义里的任何一种。
  unknown: 'bg-muted text-muted-foreground border-border',
};

export const OUTCOME_COLOR: Record<NonNullable<BoardTask['outcome']>, string> = {
  SUCCESS: statusBadgeClass('done'),
  SUCCESS_WITH_NOTES: statusBadgeClass('info'),
  REVISION_NEEDED: statusBadgeClass('waiting'),
  BLOCKED: statusBadgeClass('blocked'),
};
