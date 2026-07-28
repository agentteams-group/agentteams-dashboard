import {
  LayoutDashboard,
  Bot,
  Users,
  Crown,
  UserCheck,
  MessageSquare,
  Settings,
  BookOpen,
  Shield,
  Network,
  GitBranch,
  FlaskConical,
  FileCheck,
  type LucideIcon,
} from 'lucide-react';

export const STORAGE_KEY = 'agentteams-active-section';

export const EXPANDED_GROUPS_KEY = 'agentteams-expanded-groups';

export type DeploymentMode = 'embedded' | 'k8s';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Visible in these modes only. Omit = visible everywhere. */
  modes?: DeploymentMode[];
  /** Parent group id; undefined for persistent (non-group) entries. */
  group?: string;
}

/** Logical grouping of related nav items. */
export interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  /** First item id to activate on keyboard shortcut or group-header click. */
  defaultItem: string;
}

export const navGroups: readonly NavGroup[] = [
  { id: 'overview', label: '总览', icon: LayoutDashboard, defaultItem: 'overview' },
  { id: 'agents', label: '智能体', icon: Bot, defaultItem: 'workers' },
  { id: 'ai-gateway', label: 'AI 网关', icon: Network, defaultItem: 'gateway' },
  { id: 'platform', label: '平台', icon: Settings, defaultItem: 'topology' },
  { id: 'governance', label: '治理', icon: Shield, defaultItem: 'policies' },
] as const;

export const AI_GATEWAY_ITEMS: NavItem[] = [
  { id: 'gateway', label: 'AI 提供商 & 路由', icon: Network, group: 'ai-gateway' },
];

export const navItems: NavItem[] = [
  { id: 'overview', label: '总览', icon: LayoutDashboard, group: 'overview' },
  { id: 'workers', label: 'Workers', icon: Bot, group: 'agents' },
  { id: 'teams', label: '团队', icon: Users, group: 'agents' },
  { id: 'managers', label: 'Managers', icon: Crown, group: 'agents' },
  { id: 'humans', label: 'Humans', icon: UserCheck, group: 'agents' },
  { id: 'chat', label: 'Matrix 聊天', icon: MessageSquare, group: 'agents' },
  { id: 'topology', label: '拓扑图', icon: GitBranch, group: 'platform' },
  ...AI_GATEWAY_ITEMS,
  { id: 'policies', label: '策略', icon: Shield, group: 'governance' },
  { id: 'sandbox', label: '沙箱', icon: FlaskConical, group: 'governance' },
  { id: 'compliance', label: '合规', icon: FileCheck, group: 'governance' },
  { id: 'ops', label: '基础设施', icon: Settings, group: 'platform', modes: ['k8s'] },
  { id: 'docs', label: '文档', icon: BookOpen },
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
  modes?: DeploymentMode[];
}

export const createActions: readonly CreateAction[] = [
  { id: 'create-worker', label: '创建 Worker', icon: Bot, section: 'workers' },
  { id: 'create-team', label: '创建 Team', icon: Users, section: 'teams' },
  { id: 'create-human', label: '创建 Human', icon: UserCheck, section: 'humans' },
  { id: 'open-chat', label: '打开 Matrix 聊天', icon: MessageSquare, section: 'chat' },
] as const;

export function isCreateActionVisible(
  action: CreateAction,
  mode: DeploymentMode | null | undefined
): boolean {
  if (!action.modes) return true;
  if (!mode) return true;
  return action.modes.includes(mode);
}

/** Return the subset of navItems that belong to the given group and are visible in the current mode. */
export function getGroupItems(
  groupId: string,
  items: NavItem[],
  mode: DeploymentMode | null | undefined
): NavItem[] {
  return items.filter(
    (item) => item.group === groupId && isNavItemVisible(item, mode)
  );
}

/** Returns true when at least one navItem of this group is visible in the current mode. */
export function isGroupVisible(
  groupId: string,
  items: NavItem[],
  mode: DeploymentMode | null | undefined
): boolean {
  return getGroupItems(groupId, items, mode).length > 0;
}

/**
 * Map a legacy flat hash (e.g. "workers") to the new hierarchical format
 * (e.g. "agents/workers"). Returns null when the hash is already in the
 * new format or the section does not belong to any group.
 */
export function getNewHashFromOld(hash: string): string | null {
  if (!hash || hash.includes('/')) return null;
  const item = navItems.find((n) => n.id === hash);
  if (!item?.group) return null;
  return `${item.group}/${item.id}`;
}
