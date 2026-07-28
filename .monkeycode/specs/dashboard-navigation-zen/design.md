# 技术设计文档

## 1. 概述

将 Dashboard 侧边栏从 13 项平级列表重构为 5 个可折叠分组 + 1 个常驻入口。

### 1.1 设计原则

- **最小侵入**：保持 `agent-teams-dashboard.tsx` 中所有节组件、`sectionMap`、`createActions`、通知逻辑不变
- **渐进适配**：优先修改数据层（`nav-items.ts`），再改渲染层（`sidebar.tsx`、`mobile-sidebar.tsx`），最后改状态层（`use-active-section.ts`）
- **向后兼容**：旧版 URL 哈希 `#workers` 自动映射为 `#agents/workers`

### 1.2 技术栈

- React 18 + Next.js 14 客户端组件
- Zustand (useAgentTeamsStore)、TanStack Query、Framer Motion（已有依赖）
- 无新依赖引入

---

## 2. 数据模型设计

### 2.1 `NavGroup` 接口（新增）

```
文件：src/components/dashboard/nav-items.ts
```

```typescript
export interface NavGroup {
  id: string;           // e.g. 'agents'
  label: string;        // e.g. '智能体'
  icon: LucideIcon;
  items: NavItem[];     // 子导航项
  defaultItem?: string;  // 默认激活的子项 id（Ctrl+N 快捷键和分组点击时使用）
}
```

### 2.2 `NavItem` 接口（扩充）

在现有 `NavItem` 接口上新增一个字段：

```typescript
export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  modes?: DeploymentMode[];
  // 新增：所属分组 id，null 表示不参与分组的常驻条目
  group?: string;
}
```

### 2.3 导航项分组（实现）

| 分组 id | 标签 | 图标 | 子项 |
|---------|------|------|------|
| `overview` | 总览 | LayoutDashboard | overview |
| `agents` | 智能体 | Bot | workers, teams, managers, humans, chat |
| `ai-gateway` | AI 网关 | Network | gateway |
| `platform` | 平台 | Settings | ops, topology |
| `governance` | 治理 | Shield | policies, compliance, sandbox |

常驻入口（不参与分组）:

| id | 标签 | 图标 |
|----|------|------|
| `docs` | 文档 | BookOpen |

### 2.4 数据定义

```typescript
const AI_GATEWAY_ITEMS: NavItem[] = [
  { id: 'gateway', label: 'AI 提供商 & 路由', icon: Network, group: 'ai-gateway' },
  // 未来可扩展: { id: 'ai-consumers', ... }, { id: 'ai-models', ... }
];

export const navItems: NavItem[] = [
  { id: 'overview', label: '总览', icon: LayoutDashboard, group: 'overview' },
  { id: 'workers', label: 'Workers', icon: Bot, group: 'agents' },
  { id: 'teams', label: '团队', icon: Users, group: 'agents' },
  { id: 'managers', label: 'Managers', icon: Crown, group: 'agents' },
  { id: 'humans', label: 'Humans', icon: UserCheck, group: 'agents' },
  { id: 'chat', label: 'Matrix 聊天', icon: MessageSquare, group: 'agents' },
  { id: 'topology', label: '拓扑图', icon: GitBranch, group: 'platform' },
  { id: 'gateway', label: 'AI 提供商 & 路由', icon: Network, group: 'ai-gateway' },
  { id: 'policies', label: '策略', icon: Shield, group: 'governance' },
  { id: 'sandbox', label: '沙箱', icon: FlaskConical, group: 'governance' },
  { id: 'compliance', label: '合规', icon: FileCheck, group: 'governance' },
  { id: 'ops', label: '基础设施', icon: Settings, group: 'platform', modes: ['k8s'] },
  { id: 'docs', label: '文档', icon: BookOpen },  // 无 group，常驻底部
];

// 注意：ops 仅 K8s 模式可见，但 platform 分组内还有其他项，所以 platform 分组总是存在
```

### 2.5 分组可见性规则

当某分组内所有 `NavItem` 在该部署模式下均不可见时，该分组从侧边栏中隐藏。

辅助函数:

```typescript
export function getGroupItems(
  groupId: string,
  items: NavItem[],
  mode: DeploymentMode | null | undefined
): NavItem[] {
  return items.filter(
    (item) => item.group === groupId && isNavItemVisible(item, mode)
  );
}

export function isGroupVisible(
  groupId: string,
  items: NavItem[],
  mode: DeploymentMode | null | undefined
): boolean {
  return getGroupItems(groupId, items, mode).length > 0;
}
```

---

## 3. 状态管理重构

### 3.1 `useActiveSection` 扩展（修改）

```
文件：src/components/dashboard/use-active-section.ts
```

引入两个新的持久化状态：

1. **`activeSection`**（已存在）：当前激活的子节 id，如 `workers`
2. **`expandedGroups`**（新增）：`Set<string>`，当前展开的分组 id 集合

URL 哈希格式变更:

```typescript
// 旧格式（向后兼容处理）
// #workers

// 新格式
// #agents/workers
```

哈希解析逻辑:

```typescript
function parseHash(hash: string): { group?: string; section: string } {
  if (!hash) return { section: '' };
  
  // 新格式: #group/item
  const parts = hash.split('/');
  if (parts.length === 2) {
    const [group, section] = parts;
    return { group, section };
  }
  
  // 旧格式: #section（向后兼容）
  const section = parts[0];
  // 查找旧 section 所属分组
  const item = navItems.find((n) => n.id === section);
  return { group: item?.group, section };
}
```

初始化逻辑:

```typescript
const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
  // 从 localStorage 恢复
  try {
    const stored = localStorage.getItem(EXPANDED_GROUPS_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch {}
  
  // 默认：展开当前活跃节所在分组
  const hash = window.location.hash.slice(1);
  const { group } = parseHash(hash);
  return group ? new Set([group]) : new Set();
});
```

`setActiveSection` 副作用:

```typescript
const setActiveSection = useCallback((section: string) => {
  setActiveSectionInternal(section);
  
  // 自动展开目标节所在分组
  const item = navItems.find((n) => n.id === section);
  if (item?.group) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      // 非 Ctrl 点击：折叠其他分组，展开目标分组
      // Ctrl 点击由 sidebar 处理，此时不修改
      next.add(item.group!);
      return next;
    });
  }
}, []);
```

### 3.2 localStorage Key（新增）

```typescript
export const EXPANDED_GROUPS_KEY = 'agentteams-expanded-groups';
```

---

## 4. Sidebar 组件重构

### 4.1 `sidebar.tsx` 改造计划

#### Props 扩展

```typescript
interface SidebarProps {
  activeSection: string;
  countMap: Record<string, number>;
  sectionsWithNotifications: Set<string>;
  collapsed: boolean;
  onNavClick: (_sectionId: string) => void;
  onToggleCollapse: () => void;
  onToggleGroup?: (_groupId: string, _ctrlKey: boolean) => void;
  expandedGroups: Set<string>;
  mode?: DeploymentMode | null;
}
```

#### 渲染结构

```
<aside>
  <!-- Logo 区域（不变） -->
  <div class="logo-area">...</div>
  
  <!-- 分组导航 -->
  <nav class="flex-1">
    {visibleGroups.map(group => (
      <NavGroup key={group.id}>
        {/* 分组标题（可点击展开/折叠） */}
        <button onClick={toggleGroup}>
          <Icon />
          <span>{label}</span>
          <Badge>{totalCount}</Badge>
          <ChevronDown/Right />
        </button>
        
        {isExpanded && group.items.map(item => (
          <NavButton item={item} ... />
        ))}
      </NavGroup>
    ))}
    
    {/* 分隔线 */}
    <Separator />
    
    {/* 常驻导航项（文档） */}
    {persistentItems.map(item => (
      <NavButton item={item} ... />
    ))}
  </nav>
  
  <!-- 折叠按钮（不变） -->
  <div class="collapse-toggle">...</div>
</aside>
```

#### `NavGroup` 内部组件

```typescript
function NavGroupSection({
  group,
  items,
  activeSection,
  expandedGroups,
  countMap,
  sectionsWithNotifications,
  collapsed,
  onNavClick,
  onToggleGroup,
}: {
  group: NavGroup;
  items: NavItem[];
  activeSection: string;
  expandedGroups: Set<string>;
  countMap: Record<string, number>;
  sectionsWithNotifications: Set<string>;
  collapsed: boolean;
  onNavClick: (_sectionId: string) => void;
  onToggleGroup: (_groupId: string, _ctrlKey: boolean) => void;
}) {
  const isExpanded = expandedGroups.has(group.id);
  const isActiveInGroup = items.some((item) => item.id === activeSection);
  const GroupIcon = group.icon;
  const Chevron = isExpanded ? ChevronDown : ChevronRight;
  
  // 分组内所有项的数量合计（需求 7）
  const groupCount = items.reduce((sum, item) => sum + (countMap[item.id] ?? 0), 0);
  const hasGroupNotification = items.some(
    (item) => sectionsWithNotifications.has(item.id)
  );

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleGroup(group.id, e.ctrlKey || e.metaKey);
  };

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={handleToggle} className="...">
            <GroupIcon />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {group.label} {groupCount > 0 && `(${groupCount})`}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div>
      {/* 分组头部 */}
      <button onClick={handleToggle} className={`flex items-center gap-3 px-4 py-2.5 text-sm w-full ... ${isActiveInGroup ? 'font-semibold' : ''}`}>
        <GroupIcon className="w-5 h-5" />
        <span className="flex-1 truncate">{group.label}</span>
        {groupCount > 0 && <Badge>{groupCount}</Badge>}
        {hasGroupNotification && <span className="notification-dot" />}
        <Chevron className="w-4 h-4 transition-transform" />
      </button>
      
      {/* 子项列表（animated） */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {items.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                idx={0}  // 无快捷键编号
                isActive={activeSection === item.id}
                count={countMap[item.id] ?? 0}
                hasNotification={sectionsWithNotifications.has(item.id)}
                collapsed={false}
                onNavClick={onNavClick}
                indent  // 新增缩进样式
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

#### `NavButton` 微调

- 移除 `kbd` 快捷键编号显示
- 新增 `indent` prop 控制缩进（子项左侧增加 8px padding）

#### 分组切换逻辑

```typescript
function handleToggleGroup(groupId: string, ctrlKey: boolean) {
  setExpandedGroups((prev) => {
    const next = new Set(prev);
    if (ctrlKey) {
      // Ctrl+点击：独立切换
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
    } else {
      // 普通点击：折叠其他，仅展开当前
      if (next.has(groupId) && next.size === 1) {
        // 已展开且是唯一展开项 → 保持展开
        // （允许所有分组折叠，但首个分组点击时默认展开）
      } else {
        next.clear();
        next.add(groupId);
      }
    }
    return next;
  });
}
```

### 4.2 `mobile-sidebar.tsx` 改造计划

与桌面端侧边栏一致的渲染逻辑，但移除 `collapsed` 相关逻辑（移动端始终展开显示全内容）。

移动端点击子项后自动关闭侧边栏（已有 `onNavClick` 中调用 `setMobileMenuOpen(false)`，保持不变）。

---

## 5. 键盘快捷键适配

```
文件：src/components/dashboard/agent-teams-dashboard.tsx
```

修改 `handleKeyDown` 处理器:

```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    const isCmdOrCtrl = e.metaKey || e.ctrlKey;
    if (!isCmdOrCtrl) return;
    
    // Ctrl+0: 文档
    if (e.key === '0') {
      e.preventDefault();
      setActiveSection('docs');
      return;
    }
    
    // Ctrl+1-5: 分组默认项
    if (e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const index = parseInt(e.key, 10) - 1;
      if (index < navGroups.length) {
        setActiveSection(navGroups[index].defaultItem ?? navGroups[index].items[0].id);
      }
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [setActiveSection]);
```

---

## 6. 面包屑适配

```
文件：src/components/dashboard/agent-teams-dashboard.tsx
```

面包屑需要反映层级:

```tsx
<nav className="breadcrumb">
  <Home /> → AgentTeams → {groupLabel} → {itemLabel}
</nav>
```

确定 `groupLabel`:

```typescript
const activeItem = navItems.find((n) => n.id === activeSection);
const activeGroup = activeItem?.group
  ? navGroups.find((g) => g.id === activeItem.group)
  : null;
```

渲染:

```tsx
{activeGroup ? (
  <>
    <ChevronSep />
    <span>{activeGroup.label}</span>
    <ChevronSep />
    <span className="font-medium">{activeLabel}</span>
  </>
) : (
  <>
    <ChevronSep />
    <span className="font-medium">{activeLabel}</span>
  </>
)}
```

---

## 7. 向后兼容性映射

旧版哈希到新版哈希的映射函数:

```typescript
export function getNewHashFromOld(hash: string): string | null {
  if (hash.includes('/')) return null; // 已是新格式
  
  const item = navItems.find((n) => n.id === hash);
  if (!item?.group) return null;
  
  return `${item.group}/${item.id}`;
}
```

在 `useActiveSection` 初始化时:

```typescript
const hash = window.location.hash.slice(1);
const { group, section } = parseHash(hash);

if (group && section) {
  // 新格式
  initialSection = section;
  initialExpandedGroups = new Set([group]);
} else if (section) {
  // 旧格式 → 兼容映射
  const item = navItems.find((n) => n.id === section);
  if (item?.group) {
    // 静默更新 URL 为新格式
    window.location.hash = `${item.group}/${item.id}`;
    initialSection = section;
    initialExpandedGroups = new Set([item.group]);
  }
}
```

---

## 8. 文件变更清单

| 文件 | 变更类型 | 变更摘要 |
|------|---------|---------|
| `src/components/dashboard/nav-items.ts` | 修改 | 新增 `NavGroup` 接口，`navItems` 增加 `group` 字段，导出 `navGroups` 数组，新增 `getGroupItems`、`isGroupVisible`、`getNewHashFromOld` 辅助函数 |
| `src/components/dashboard/use-active-section.ts` | 修改 | 重构哈希解析为 `group/section` 格式，新增 `expandedGroups` 状态，向后兼容旧格式 |
| `src/components/dashboard/sidebar.tsx` | 修改 | Props 新增 `expandedGroups`、`onToggleGroup`，重构渲染为分组+常驻入口结构，新增 `NavGroupSection` 内部组件 |
| `src/components/dashboard/mobile-sidebar.tsx` | 修改 | 与 sidebar 一致的分组渲染逻辑，Props 新增 `expandedGroups`、`onToggleGroup` |
| `src/components/dashboard/agent-teams-dashboard.tsx` | 修改 | Props 透传 `expandedGroups` 和 `onToggleGroupHandle`，修改键盘快捷键映射（Ctrl+1-5 → 分组），修改面包屑渲染，修改 `visibleNavItems` 为 `visibleGroups` |
| `src/components/dashboard/use-active-section.test.ts` | 新增 | 覆盖哈希解析、向后兼容、分组展开/折叠 |
| `src/components/dashboard/sidebar.test.tsx` | 新增 | 覆盖分组渲染、子项可见性、分组折叠/展开、文档常驻 |

---

## 9. 测试计划

### 9.1 `use-active-section.test.ts`

```typescript
describe('useActiveSection', () => {
  it('should parse #agents/workers hash to { group: "agents", section: "workers" }');
  it('should auto-expand the group containing the active section');
  it('should map old #workers hash to new #agents/workers');
  it('should persist expanded groups to localStorage');
  it('should restore expanded groups from localStorage');
  it('should fall back to overview when hash section is invalid');
});
```

### 9.2 `sidebar.test.tsx`

```typescript
describe('Sidebar with groups', () => {
  it('should render 5 group headers');
  it('should render sub-items only for expanded groups');
  it('should render docs as persistent entry at bottom');
  it('should show group count as sum of sub-item counts');
  it('should hide empty groups when all items filtered by mode');
  it('should toggle group on click');
  it('should not collapse other groups on Ctrl+click');
  it('should collapse other groups on normal click');
  it('should auto-expand group containing active section');
});
```

---

## 10. 实施步骤

1. **数据层**：修改 `nav-items.ts`，定义 `NavGroup`，为 `navItems` 添加 `group` 字段
2. **状态层**：修改 `use-active-section.ts`，引入分组展开状态和哈希层级解析
3. **侧边栏渲染层**：修改 `sidebar.tsx`，重构为分组渲染
4. **移动端侧边栏**：修改 `mobile-sidebar.tsx`，同步分组渲染
5. **主组件**：修改 `agent-teams-dashboard.tsx`，更新快捷键、面包屑、Props 透传
6. **运行测试验证**：`npm test`、`npm run lint`、`npm run typecheck`
7. **视觉回归检查**：启动 dev server 预览
