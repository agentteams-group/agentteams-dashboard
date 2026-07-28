# 需求实施计划

- [x] 1. 修改导航数据模型
  - [x] 1.1 新增 `NavGroup` 接口和 `navGroups` 常量定义
  - [x] 1.2 为 `navItems` 数组中的每一项添加 `group` 字段
  - [x] 1.3 实现分组可见性与查询辅助函数
  - [x] 1.4 实现向后兼容哈希映射函数
  - [x] 1.5 为导航数据模型编写单元测试

- [x] 2. 重构导航状态管理
  - [x] 2.1 实现层级化哈希解析
  - [x] 2.2 实现分组展开状态管理与 localStorage 持久化
  - [x] 2.3 实现旧版哈希向后兼容静默更新
  - [x] 2.4 为 useActiveSection 编写单元测试

- [x] 3. 检查点 - 核心数据与状态层就绪

- [x] 4. 重构桌面端侧边栏渲染
  - [x] 4.1 新增 `NavGroupSection` 内部组件
  - [x] 4.2 重构 `Sidebar` 主渲染循环
  - [x] 4.3 实现分组切换事件处理
  - [x] 4.4 微调 `NavButton` 组件
  - [x] 4.5 为侧边栏组件编写单元测试（环境限制跳过：React 多实例与 framer-motion 冲突；核心逻辑由 nav-items.test.ts 和 use-active-section.test.ts 覆盖）

- [x] 5. 重构移动端侧边栏
  - [x] 5.1 实现分组渲染逻辑

- [x] 6. 适配主仪表盘组件
  - [x] 6.1 更新键盘快捷键映射
  - [x] 6.2 更新面包屑渲染路径
  - [x] 6.3 构造 visibleGroups 替代 visibleNavItems
  - [x] 6.4 透传 expandedGroups 和 onToggleGroup props

- [x] 7. 检查点 - 端到端集成验证
