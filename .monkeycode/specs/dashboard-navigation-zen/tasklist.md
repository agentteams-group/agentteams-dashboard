# 需求实施计划

- [ ] 1. 修改导航数据模型
  - [ ] 1.1 新增 `NavGroup` 接口和 `navGroups` 常量定义
    - 定义 NavGroup: { id, label, icon, items, defaultItem }
    - 创建 5 个分组常量: `NAV_GROUP_OVERVIEW`, `NAV_GROUP_AGENTS`, `NAV_GROUP_AI_GATEWAY`, `NAV_GROUP_PLATFORM`, `NAV_GROUP_GOVERNANCE`
    - 定义 `navGroups` 数组（需求 1: 5 分组结构）
    - 设计 2.1, 2.3

  - [ ] 1.2 为 `navItems` 数组中的每一项添加 `group` 字段
    - overview → group 'overview'
    - workers/teams/managers/humans/chat → group 'agents'
    - gateway → group 'ai-gateway'
    - ops (仅 k8s 模式) + topology → group 'platform'
    - policies/compliance/sandbox → group 'governance'
    - docs → 无 group，作为常驻入口
    - 引入 `AI_GATEWAY_ITEMS` 中间常量（设计 2.4: gateway 标签更新为「AI 提供商 & 路由」）
    - 需求 1, 2

  - [ ] 1.3 实现分组可见性与查询辅助函数
    - `getGroupItems(groupId, items, mode)` — 返回某分组在当前模式下的可见子项
    - `isGroupVisible(groupId, items, mode)` — 判断分组是否有可见子项（需求 8: 空分组隐藏）
    - 需求 8, 设计 2.5

  - [ ] 1.4 实现向后兼容哈希映射函数
    - `getNewHashFromOld(hash)` — 将旧版 `#workers` 映射为新版 `#agents/workers`
    - 若旧 section 无 group，返回 null
    - 需求 4 (向后兼容), 设计 7

  - [ ] 1.5 为导航数据模型编写单元测试
    - 测试 navItems 中每个有 group 的项必在 navGroups 中存在对应分组
    - 测试 getGroupItems 在 embedded 和 k8s 两种模式下返回值正确
    - 测试 isGroupVisible 在无可见子项时返回 false
    - 测试 getNewHashFromOld 正确映射旧格式

- [ ] 2. 重构导航状态管理
  - [ ] 2.1 实现层级化哈希解析
    - 新增 `parseHash(hash)` 函数，解析 `#agents/workers` → { group: 'agents', section: 'workers' }
    - 同时兼容 `#workers` → { group: undefined, section: 'workers' }
    - 更新 `useActiveSection` 初始化逻辑使用 parseHash
    - 更新 `setActiveSection` 中 URL hash 写入为 `#group/section` 格式
    - 需求 4 (层级化 URL 哈希), 设计 3.1

  - [ ] 2.2 实现分组展开状态管理与 localStorage 持久化
    - 新增 `expandedGroups` 状态 (Set<string>)
    - 初始化: 从 localStorage key `agentteams-expanded-groups` 恢复；fallback 为包含当前 activeSection 所在分组
    - `setActiveSection` 时自动将目标 section 所在分组加入 expandedGroups
    - 每次 expandedGroups 变更时写入 localStorage
    - 新增 `EXPANDED_GROUPS_KEY` 常量到 nav-items.ts
    - 需求 3 (展开/折叠 + 持久化), 设计 3.1, 3.2

  - [ ] 2.3 实现旧版哈希向后兼容静默更新
    - 在 `useActiveSection` 初始化时检测旧格式哈希
    - 匹配到旧 section → 查找其 group，静默替换 URL hash 为新格式
    - 需求 4 (向后兼容), 设计 3.1

  - [ ] 2.4 为 useActiveSection 编写单元测试
    - 测试 parseHash 解析 `#agents/workers` 返回 { group: 'agents', section: 'workers' }
    - 测试 parseHash 解析 `#workers` 返回 { group: undefined, section: 'workers' }
    - 测试 setActiveSection 写入 `#group/section` 格式 URL hash
    - 测试旧版 hash 被自动映射为新格式
    - 测试 expandedGroups 从 localStorage 恢复
    - 测试切换 section 时自动展开对应分组

- [ ] 3. 检查点 - 核心数据与状态层就绪
  - 运行 `npx vitest run src/components/dashboard/nav-items.test.ts src/components/dashboard/use-active-section.test.ts` 确认全部通过
  - 运行 `npm run lint` 和 `npm run typecheck` 通过
  - 如有疑问请询问用户

- [ ] 4. 重构桌面端侧边栏渲染
  - [ ] 4.1 新增 `NavGroupSection` 内部组件
    - 渲染分组标题按钮: 分组图标 + 标签 + 分组合计计数徽章 + 通知圆点 + Chevron 展开指示器
    - 子项列表: 使用 framer-motion `AnimatePresence` + `motion.div` 实现展开/折叠动画
    - 每个子项通过 `NavButton` 渲染，传入 `indent` prop
    - 分组合计计数 = 子项 countMap 求和（需求 7: 节点计数组件适配）
    - 设计 4.1

  - [ ] 4.2 重构 `Sidebar` 主渲染循环
    - Props 扩展: 新增 `expandedGroups: Set<string>` 和 `onToggleGroup: (_groupId: string, _ctrlKey: boolean) => void`
    - 替换原有 `visibleItems.map` 为: 遍历 `navGroups` → 过滤 `isGroupVisible` → 渲染 `NavGroupSection`
    - 分组列表后插入分隔线 (`Separator`) + 常驻文档入口 (NavButton for docs, 无 group 筛选)
    - 需求 1, 2, 8

  - [ ] 4.3 实现分组切换事件处理
    - `handleToggleGroup(groupId, ctrlKey)`: 普通点击 → 折叠其他分组，仅展开当前；Ctrl+点击 → 独立切换
    - 当 expandedGroups 只有目标分组且已展开 → 不折叠（允许单击保持展开）
    - 在 `onNavClick` 中触发自动展开目标 section 所在分组
    - 需求 3, 设计 4.1

  - [ ] 4.4 微调 `NavButton` 组件
    - 移除 `kbd` 快捷键编号显示（`{idx + 1}`）
    - 新增 `indent` prop: 当为 true 时左侧 padding 增加（子项缩进）
    - 需求 1 (分组子项缩进视觉效果), 设计 4.1

  - [ ] 4.5 为侧边栏组件编写单元测试
    - 测试渲染 5 个分组标题
    - 测试仅展开的分组展示子项，折叠的分组隐藏子项
    - 测试文档常驻入口始终存在且位于分组之后
    - 测试分组标题旁合计计数 = 子项 count 求和
    - 测试 isGroupVisible=false 的分组不渲染
    - 测试普通点击展开当前分组并折叠其他
    - 测试 Ctrl+点击独立切换分组展开

- [ ] 5. 重构移动端侧边栏
  - [ ] 5.1 实现分组渲染逻辑
    - Props 扩展: 新增 `expandedGroups` 和 `onToggleGroup`
    - 替换原有 `visibleItems.map` 为分组 + 常驻逻辑（与桌面端一致）
    - 支持触控点击分组标题切换展开/折叠（需求 6: 移动端适配）
    - 点击子项后调用 `onNavClick`（已内置 `setMobileMenuOpen(false)`，满足需求 6.3）
    - 需求 6, 设计 4.2

- [ ] 6. 适配主仪表盘组件
  - [ ] 6.1 更新键盘快捷键映射
    - `Ctrl+1` 至 `Ctrl+5` → 激活 navGroups[index].defaultItem（需求 5）
    - `Ctrl+0` → 激活 docs（需求 5.4: 常驻入口快捷键）
    - 移除旧的 `visibleNavItems` 索引映射
    - 需求 5, 设计 5

  - [ ] 6.2 更新面包屑渲染路径
    - 查找 activeSection 对应的 NavItem 和 NavGroup
    - 有分组: `Home → 分组标签 → 子项标签`（设计 6）
    - 无分组（如 docs）: `Home → 子项标签`（保持现状）
    - 设计 6

  - [ ] 6.3 构造 visibleGroups 替代 visibleNavItems
    - 使用 `useMemo` 计算 visibleGroups: 过滤 isGroupVisible 的 navGroups
    - 保留原有 `visibleNavItems` 或替换引用点
    - 活跃节守卫逻辑: `!visibleNavItems.some(n => n.id === activeSection)` 保持不变
    - 需求 8, 设计 4.1

  - [ ] 6.4 透传 expandedGroups 和 onToggleGroup props
    - 在 `handleNavClick` 回调中自动展开目标 section 所在分组
    - 将 `expandedGroups` 和 `handleToggleGroup` 传入 `Sidebar` 和 `MobileSidebar`
    - 设计 4.1

- [ ] 7. 检查点 - 端到端集成验证
  - 运行 `npm test` 确认全部测试通过
  - 运行 `npm run lint` 和 `npm run typecheck` 通过
  - 启动 dev server 手动验证: 分组展开/折叠、层级面包屑、Ctrl+快捷键、URL 哈希持久化、移动端适配
  - 如有疑问请询问用户
