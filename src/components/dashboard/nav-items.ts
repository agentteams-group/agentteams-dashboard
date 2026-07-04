import {
  LayoutDashboard,
  Bot,
  Users,
  Crown,
  UserCheck,
  MessageSquare,
  Server,
  Container,
  Sparkles,
  GitBranch,
  Shield,
  Cpu,
  Rocket,
  type LucideIcon,
} from 'lucide-react';

export const STORAGE_KEY = 'hiclaw-active-section';

export type DeploymentMode = 'embedded' | 'k8s';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Visible in these modes only. Omit = visible everywhere. */
  modes?: DeploymentMode[];
}

export const navItems: NavItem[] = [
  { id: 'overview', label: '总览', icon: LayoutDashboard },
  { id: 'workers', label: 'Workers', icon: Bot },
  { id: 'teams', label: '团队', icon: Users },
  { id: 'managers', label: 'Managers', icon: Crown },
  { id: 'humans', label: 'Humans', icon: UserCheck },
  { id: 'chat', label: 'Matrix 聊天', icon: MessageSquare },
  { id: 'infrastructure', label: '基础设施', icon: Server, modes: ['k8s'] },
  { id: 'k8s', label: 'K8s 资源', icon: Container, modes: ['k8s'] },
  { id: 'skills', label: '技能生态', icon: Sparkles },
  { id: 'architecture', label: '架构', icon: GitBranch },
  { id: 'security', label: '安全模型', icon: Shield },
  { id: 'runtime', label: '多运行时', icon: Cpu },
  { id: 'quickstart', label: '快速开始', icon: Rocket },
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
