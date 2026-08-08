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
  type LucideIcon,
} from 'lucide-react';

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
}

export const navItems: NavItem[] = [
  { id: 'overview', label: '总览', icon: LayoutDashboard, group: 'core' },
  { id: 'chat', label: '聊天', icon: MessageSquare, group: 'core' },
  // 运行时分组
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
];

export function isNavItemVisible(
  item: NavItem,
  mode: DeploymentMode | null | undefined
): boolean {
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
}

export const createActions: readonly CreateAction[] = [
  { id: 'create-worker', label: '创建 Worker', icon: Bot, section: 'workers', group: 'runtime' },
  { id: 'create-team', label: '创建团队', icon: Users, section: 'teams', group: 'runtime' },
  { id: 'create-human', label: '创建 Human', icon: UserCheck, section: 'humans', group: 'runtime' },
  { id: 'open-chat', label: '打开聊天', icon: MessageSquare, section: 'chat', group: 'core' },
] as const;

export function isCreateActionVisible(
  action: CreateAction,
  mode: DeploymentMode | null | undefined
): boolean {
  if (!action.modes) return true;
  if (!mode) return true;
  return action.modes.includes(mode);
}
