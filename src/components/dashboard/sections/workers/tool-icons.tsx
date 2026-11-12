'use client';

// Worker 内置工具图标：Dashboard 唯一映射（对齐插件 toolIcons.tsx 的
// QWENPAW_TOOL_ICONS / TOOL_GROUP_OF）。后端 tool.icon 是 emoji，不直接
// 渲染；未知运行时/工具名按组回退 lucide 图标，绝不回退 emoji。

import { createElement } from 'react';
import {
  Blocks,
  Bot,
  CheckCheck,
  Clock,
  Code2,
  FilePenLine,
  FilePlus2,
  FileText,
  FolderSearch,
  Gauge,
  Globe,
  Image,
  Layers,
  ListChecks,
  MailCheck,
  MessagesSquare,
  Monitor,
  PanelsTopLeft,
  RefreshCw,
  ScanSearch,
  Search,
  Send,
  Settings,
  Sparkles,
  Terminal,
  Users,
  Video,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

type ToolGroup = 'files' | 'web' | 'media' | 'agents' | 'runtime' | 'migration' | 'other';

/** QwenPaw 内置工具名 → lucide 图标（逐行对齐插件 TOOL_PRESENTATION）。 */
const QWENPAW_TOOL_ICONS: Record<string, LucideIcon> = {
  execute_shell_command: Terminal,
  read_file: FileText,
  write_file: FilePlus2,
  edit_file: FilePenLine,
  append_file: FilePlus2,
  grep_search: Search,
  glob_search: FolderSearch,
  ast_search: Code2,
  desktop_screenshot: Monitor,
  view_image: Image,
  view_video: Video,
  enhance_and_generate_image: Sparkles,
  web_search: Search,
  web_fetch: Globe,
  browser: PanelsTopLeft,
  list_agents: Users,
  chat_with_agent: MessagesSquare,
  submit_to_agent: Send,
  check_agent_task: ListChecks,
  spawn_subagent: Workflow,
  delegate_external_agent: Bot,
  send_file_to_user: Send,
  get_current_time: Clock,
  set_user_timezone: Globe,
  get_token_usage: Gauge,
  materialize_skill: Blocks,
  run_tool_batch: Layers,
  activate_f1_exploration_mode: MailCheck,
  migration_compat_inspect: ScanSearch,
  migration_compat_read_file: FileText,
  migration_compat_write_file: FilePenLine,
  migration_compat_update: RefreshCw,
  migration_compat_finalize: CheckCheck,
};

/** 工具名 → 分组（与插件 TOOL_GROUP_OF 同口径）；表外归 other。 */
const TOOL_GROUP_OF: Record<string, ToolGroup> = {
  read_file: 'files',
  write_file: 'files',
  edit_file: 'files',
  append_file: 'files',
  grep_search: 'files',
  glob_search: 'files',
  ast_search: 'files',
  send_file_to_user: 'files',
  web_search: 'web',
  web_fetch: 'web',
  browser: 'web',
  desktop_screenshot: 'media',
  view_image: 'media',
  view_video: 'media',
  enhance_and_generate_image: 'media',
  list_agents: 'agents',
  chat_with_agent: 'agents',
  submit_to_agent: 'agents',
  check_agent_task: 'agents',
  spawn_subagent: 'agents',
  delegate_external_agent: 'agents',
  execute_shell_command: 'runtime',
  get_current_time: 'runtime',
  set_user_timezone: 'runtime',
  get_token_usage: 'runtime',
  materialize_skill: 'runtime',
  run_tool_batch: 'runtime',
  activate_f1_exploration_mode: 'runtime',
  migration_compat_inspect: 'migration',
  migration_compat_read_file: 'migration',
  migration_compat_write_file: 'migration',
  migration_compat_update: 'migration',
  migration_compat_finalize: 'migration',
};

/** 组兜底图标（未知运行时 / 未知工具名）。 */
const TOOL_GROUP_ICONS: Record<ToolGroup, LucideIcon> = {
  files: FileText,
  web: Globe,
  media: Image,
  agents: Users,
  runtime: Settings,
  migration: RefreshCw,
  other: Wrench,
};

/** 运行时 → 工具图标表（新增运行时在此补一张表）。 */
const RUNTIME_TOOL_ICONS: Record<string, Record<string, LucideIcon>> = {
  qwenpaw: QWENPAW_TOOL_ICONS,
};

/** 解析工具图标：运行时表 → 分组兜底（永不返回空）。 */
export function resolveToolIcon(runtime: string | undefined, name: string): LucideIcon {
  const key = (runtime ?? '').trim().toLowerCase();
  return RUNTIME_TOOL_ICONS[key]?.[name] ?? TOOL_GROUP_ICONS[TOOL_GROUP_OF[name] ?? 'other'];
}

/** 单工具图标；包装层带 data-testid，SVG 本身对读屏隐藏。 */
export function WorkerToolIcon({
  name,
  runtime,
  className = 'size-4',
}: {
  name: string;
  runtime?: string;
  className?: string;
}) {
  const Icon = resolveToolIcon(runtime, name);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center"
      data-testid={`tool-icon-${name}`}
      aria-hidden="true"
    >
      {createElement(Icon, { className, 'aria-hidden': true })}
    </span>
  );
}
