import {
  LayoutDashboard,
  Bot,
  Users,
  Crown,
  UserCheck,
  MessageSquare,
  BookOpen,
  Brain,
  Sparkles,
  ListTodo,
  GitBranch,
  type LucideIcon,
} from 'lucide-react';
import { useAgentTeamsStore } from '@/lib/agentteams-store';

export const STORAGE_KEY = 'agentteams-active-section';

export type DeploymentMode = 'embedded' | 'k8s';

export type NavGroup = 'core' | 'runtime' | 'resource' | 'footer';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
  /** Visible in these modes only. Omit = visible everywhere. */
  modes?: DeploymentMode[];
  /** When true, the item is hidden if the matching feature flag is off. */
  hiddenByFlag?: 'taskBoard';
}

export const navItems: NavItem[] = [
  { id: 'overview', label: '总览', icon: LayoutDashboard, group: 'core' },
  { id: 'chat', label: '聊天', icon: MessageSquare, group: 'core' },
  // 运行时分组
  { id: 'tasks', label: '任务看板', icon: ListTodo, group: 'runtime', hiddenByFlag: 'taskBoard' },
  { id: 'projects', label: '项目', icon: GitBranch, group: 'runtime' },
  { id: 'workers', label: 'Workers', icon: Bot, group: 'runtime' },
  { id: 'managers', label: 'Managers', icon: Crown, group: 'runtime' },
  { id: 'teams', label: '团队', icon: Users, group: 'runtime' },
  { id: 'humans', label: 'Humans', icon: UserCheck, group: 'runtime' },
  // 资源中心分组
  { id: 'skills', label: '市场', icon: Sparkles, group: 'resource' },
  { id: 'models', label: '模型', icon: Brain, group: 'resource' },
  { id: 'docs', label: '文档', icon: BookOpen, group: 'footer' },
];

export const navGroups: { id: NavGroup; label: string }[] = [
  { id: 'core', label: '基础' },
  { id: 'runtime', label: '运行时' },
  { id: 'resource', label: '资源中心' },
  { id: 'footer', label: '' },
];

export function isNavItemVisible(
  item: NavItem,
  mode: DeploymentMode | null | undefined,
  taskBoardVisible?: boolean
): boolean {
  if (item.hiddenByFlag === 'taskBoard') {
    // Prefer the caller-provided value (reactive); fall back to the live
    // zustand store for non-React call sites.
    const visible = taskBoardVisible ?? useAgentTeamsStore.getState().taskBoardVisible;
    if (!visible) return false;
  }
  if (!item.modes) return true;
  if (!mode) return true;
  return item.modes.includes(mode);
}

export interface CreateAction {
  id: string;
  label: string;
  icon: LucideIcon;
  section: string;
  group?: NavGroup;
  modes?: DeploymentMode[];
  hiddenByFlag?: 'taskBoard';
}

export const createActions: readonly CreateAction[] = [
  { id: 'create-worker', label: '创建 Worker', icon: Bot, section: 'workers', group: 'runtime' },
  { id: 'create-team', label: '创建团队', icon: Users, section: 'teams', group: 'runtime' },
  { id: 'create-human', label: '创建 Human', icon: UserCheck, section: 'humans', group: 'runtime' },
  { id: 'open-chat', label: '打开聊天', icon: MessageSquare, section: 'chat', group: 'core' },
] as const;

export function isCreateActionVisible(
  action: CreateAction,
  mode: DeploymentMode | null | undefined,
  taskBoardVisible?: boolean
): boolean {
  if (action.hiddenByFlag === 'taskBoard') {
    const visible = taskBoardVisible ?? useAgentTeamsStore.getState().taskBoardVisible;
    if (!visible) return false;
  }
  if (!action.modes) return true;
  if (!mode) return true;
  return action.modes.includes(mode);
}
