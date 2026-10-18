import {
  LayoutDashboard,
  Bot,
  Users,
  Crown,
  UserCheck,
  MessageSquare,
  Brain,
  Sparkles,
  ListTodo,
  ScrollText,
  SquareTerminal,
  RefreshCcw,
  Hammer,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { ArtifactsBoxIcon } from '@/components/dashboard/artifacts-box-icon';
import { KnowledgeBookIcon } from '@/components/dashboard/knowledge-book-icon';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import type { NavArea } from '@/lib/nav-hash';

export const STORAGE_KEY = 'agentteams-active-section';

export type DeploymentMode = 'embedded' | 'k8s';

/**
 * Workbench IA (PRD §5.2): 工作台（协作空间 + 任务中心）为主轴，控制台
 * （资源 + 治理 + 系统）为二级。分组按「区 + 区内分组」两段表达。
 */
export type NavGroup =
  | 'space'
  | 'task-center'
  | 'loop'
  | 'resources'
  | 'governance'
  | 'system'
  | 'footer';

/**
 * Pre-Workbench flat grouping (v1.x 基础/运行时/资源中心)，仅服务
 * 「经典导航」开关（PRD §5.4，默认关，保留一个版本周期）。
 */
export type LegacyNavGroup = 'core' | 'runtime' | 'resource';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  area: NavArea;
  group: NavGroup;
  /** Classic-navigation grouping; omitted for items with no legacy home. */
  legacyGroup?: LegacyNavGroup;
  /** Visible in these modes only. Omit = visible everywhere. */
  modes?: DeploymentMode[];
  /** When true, the item is hidden if the matching feature flag is off. */
  hiddenByFlag?: 'taskBoard';
  /**
   * Minimum dashboard rbac level required to see this item (M19).
   * 3 = Admin/L1 only. UI convenience gate; the Controller enforces the
   * real boundary.
   */
  minLevel?: 1 | 2 | 3;
}

export const navItems: NavItem[] = [
  // ── 工作台（一级主线） ──
  // 协作空间：Matrix 房间升级为「工作单元」（F1.1）。id 仍为 chat。
  { id: 'chat', label: '协作空间', icon: MessageSquare, area: 'workbench', group: 'space', legacyGroup: 'core' },
  // 任务中心（原「任务看板 + 产物 + 编码执行」收拢，13 项零删减）。
  // The standalone projects section was merged into the task board's 项目
  // view, so there is no longer a separate 'projects' nav item.
  { id: 'tasks', label: '任务看板', icon: ListTodo, area: 'workbench', group: 'task-center', legacyGroup: 'runtime', hiddenByFlag: 'taskBoard' },
  // 产物（项目→任务→产物文件树 + 预览/下载）。项目视图已并入任务看板，
  // 数据依赖同样是 Controller 项目端点，故与任务看板同走 taskBoard 标志；
  // 图标为手绘 SVG 箱子（lucide 同款规格）。
  { id: 'artifacts', label: '产物', icon: ArtifactsBoxIcon, area: 'workbench', group: 'task-center', legacyGroup: 'runtime', hiddenByFlag: 'taskBoard' },
  // 编码执行记录（#146 缺口 2）：编码 CLI 一次性执行记录 + 原始日志（只读）。
  { id: 'coding-runs', label: '编码执行', icon: SquareTerminal, area: 'workbench', group: 'task-center', legacyGroup: 'runtime' },
  // 循环（M3 F5.2-F5.5）：定义/发布/复用由 Dashboard 承载，执行在上游。
  { id: 'loops', label: '循环', icon: RefreshCcw, area: 'workbench', group: 'loop' },

  // ── 控制台（二级：资源与治理合并） ──
  // 资源：Agent 目录 + 市场 + 模型 + 知识库（F7.1）。
  { id: 'workers', label: 'Workers', icon: Bot, area: 'console', group: 'resources', legacyGroup: 'runtime' },
  // L1-only (minLevel 3): the Controller's A2 chain 403s L2 (Matrix token)
  // reads on managers, and the humans list exposes sensitive fields
  // (initialPassword) that must not be visible to team-level users.
  { id: 'managers', label: 'Managers', icon: Crown, area: 'console', group: 'resources', legacyGroup: 'runtime', minLevel: 3 },
  { id: 'teams', label: '团队', icon: Users, area: 'console', group: 'resources', legacyGroup: 'runtime' },
  { id: 'humans', label: 'Humans', icon: UserCheck, area: 'console', group: 'resources', legacyGroup: 'runtime', minLevel: 3 },
  { id: 'skills', label: '市场', icon: Sparkles, area: 'console', group: 'resources', legacyGroup: 'resource' },
  { id: 'models', label: '模型', icon: Brain, area: 'console', group: 'resources', legacyGroup: 'resource' },
  // 知识库（#1208 workspace-files 消费：MEMORY.md/memory/**/digest/** 只读 +
  // wikilink 2D 图谱）。图标=手绘 SVG 摊书（lucide 同款规格）。
  { id: 'knowledge', label: '知识库', icon: KnowledgeBookIcon, area: 'console', group: 'resources', legacyGroup: 'resource' },
  // 治理：审计。
  { id: 'audit', label: '审计', icon: ScrollText, area: 'console', group: 'governance', legacyGroup: 'resource' },
  // 系统：集群概览归入系统（附录 A）。
  { id: 'overview', label: '总览', icon: LayoutDashboard, area: 'console', group: 'system', legacyGroup: 'core' },
];

/** 工作台/控制台两级的区定义（侧栏一级入口）。 */
export const navAreas: { id: NavArea; label: string; icon: LucideIcon }[] = [
  { id: 'workbench', label: '工作台', icon: Hammer },
  { id: 'console', label: '控制台', icon: Wrench },
];

/** 区内分组定义。 */
export const navGroups: { area: NavArea; id: NavGroup; label: string }[] = [
  { area: 'workbench', id: 'space', label: '协作空间' },
  { area: 'workbench', id: 'task-center', label: '任务中心' },
  { area: 'workbench', id: 'loop', label: '循环' },
  { area: 'console', id: 'resources', label: '资源' },
  { area: 'console', id: 'governance', label: '治理' },
  { area: 'console', id: 'system', label: '系统' },
];

/** 经典导航的平铺分组（v1.x 口径，仅 classicNavigation 开启时渲染）。 */
export const legacyNavGroups: { id: LegacyNavGroup; label: string }[] = [
  { id: 'core', label: '基础' },
  { id: 'runtime', label: '运行时' },
  { id: 'resource', label: '资源中心' },
];

export function isNavItemVisible(
  item: NavItem,
  mode: DeploymentMode | null | undefined,
  taskBoardVisible?: boolean,
  userLevel?: number
): boolean {
  // UI level gate (M19): admin-only sections for L2 users. Convenience
  // layer only — the Controller (A2) enforces the real boundary.
  if (item.minLevel && (userLevel ?? 3) < item.minLevel) return false;
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
  /** Minimum dashboard rbac level required (M19), same as NavItem. */
  minLevel?: 1 | 2 | 3;
}

export const createActions: readonly CreateAction[] = [
  { id: 'create-worker', label: '创建 Worker', icon: Bot, section: 'workers', group: 'resources' },
  { id: 'create-team', label: '创建团队', icon: Users, section: 'teams', group: 'resources' },
  { id: 'create-human', label: '创建 Human', icon: UserCheck, section: 'humans', group: 'resources', minLevel: 3 },
  { id: 'open-chat', label: '打开协作空间', icon: MessageSquare, section: 'chat', group: 'space' },
] as const;

export function isCreateActionVisible(
  action: CreateAction,
  mode: DeploymentMode | null | undefined,
  taskBoardVisible?: boolean,
  userLevel?: number
): boolean {
  if (action.minLevel && (userLevel ?? 3) < action.minLevel) return false;
  if (action.hiddenByFlag === 'taskBoard') {
    const visible = taskBoardVisible ?? useAgentTeamsStore.getState().taskBoardVisible;
    if (!visible) return false;
  }
  if (!action.modes) return true;
  if (!mode) return true;
  return action.modes.includes(mode);
}
