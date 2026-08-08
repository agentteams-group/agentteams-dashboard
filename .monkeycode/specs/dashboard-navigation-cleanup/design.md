# Dashboard 导航清理设计

Feature Name: dashboard-navigation-cleanup
Updated: 2026-08-08

## Description

导航定义集中在 `nav-items.ts`。资源中心继续承载市场和 MCP 服务器；顶层导航保留资源中心单一入口。文档项使用 `footer` 分组，由桌面和移动侧边栏在主导航之后单独呈现。

## Components and Interfaces

- `nav-items.ts` 移除 MCP 和运维中心条目，定义 `footer` 分组的文档条目。
- `AgentTeamsDashboard` 移除运维和独立 MCP 节映射。
- `ResourceCenterSection` 只呈现市场和 MCP 服务器标签。
- `Sidebar` 与 `MobileSidebar` 单独呈现 `footer` 项。

## Correctness Properties

- 每个 `navItems` 条目在 `sectionMap` 中存在对应节组件。
- MCP 服务器继续通过资源中心访问。
- 文档入口在桌面侧边栏中位于折叠控件上方。

## Test Strategy

- 更新导航条目、分组和节映射测试。
- 人工检查桌面和移动侧边栏的文档入口位置。
