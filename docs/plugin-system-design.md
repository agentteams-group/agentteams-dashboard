# AgentTeams Dashboard 插件系统技术设计

状态：已实现　|　 版本：v1　|　 关联文档：[plugin-development.zh-CN.md](./plugin-development.zh-CN.md)

## 1. 背景与目标

Dashboard 功能边界固定，第三方接入只能 fork 改代码，无法与上游同步。本设计为 Dashboard 建立一套插件机制，使第三方在**不修改核心代码**的前提下扩展功能。

目标：

- 明确的扩展点，覆盖侧边栏菜单、独立页面、仪表盘组件、详情面板区块、工具栏按钮。
- 运行时动态加载，不影响首屏性能。
- 插件隔离：独立状态、错误兜底，单插件故障不影响主应用。
- 与 AgentTeams 上游插件生态兼容。

## 2. 关键设计决策

| 决策点 | 结论 | 理由 |
| --- | --- | --- |
| 加载方式 | 运行时动态 `import()`，不用 Module Federation | 实现简单，无需额外构建配置 |
| 插件通信 | 基于 mitt 的事件总线 | 轻量，满足插件间通信 |
| 状态隔离 | 每插件独立 Zustand store，按插件 id 命名空间 | 防止状态冲突 |
| React 共享 | 宿主在 `window.__AGENTTEAMS_DASHBOARD_HOST__` 暴露 React 实例 | Hooks/Context 跨边界工作，避免双 React |
| 清单格式 | `plugin.json`，字段与上游对齐 | 复用生态与分发渠道 |

## 3. 架构

```
┌───────────────────────────────────────────────────────────────┐
│                        Dashboard (宿主)                        │
│                                                               │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐    │
│  │  Registry   │   │   Loader     │   │  Extension Store │    │
│  │ (zustand)   │──▶│ (dynamic     │──▶│  (zustand)       │    │
│  │ 安装/启停/卸载│   │  import)     │   │  各扩展点贡献集合 │    │
│  └─────────────┘   └──────────────┘   └──────────────────┘    │
│        │                 │                     │               │
│        ▼                 ▼                     ▼               │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐    │
│  │   Manager   │   │  Plugin API  │   │  Extension Hosts │    │
│  │ (生命周期编排)│   │ (activate入参)│   │ (渲染扩展点+边界)│    │
│  └─────────────┘   └──────────────┘   └──────────────────┘    │
│                                               │                │
│  ┌────────────────────────────────────────────┴───────────┐    │
│  │  sidebar / route / widgets / detail-panel / toolbar    │    │
│  └────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────┘
                          ▲ activate(api)
                          │
              ┌───────────┴───────────┐
              │  Plugin A / B / C …    │   (plugin.json + ES 模块入口)
              └───────────────────────┘
```

### 模块职责

- **Registry**（`src/lib/plugins/registry.ts`）：zustand store，保存插件记录（manifest、来源、状态、错误）、已安装 URL、禁用列表、就绪标志。持久化 `installedUrls` 与 `disabledIds`。
- **Manifest**（`manifest.ts`）：校验 `plugin.json`（id/version/entry/扩展点/权限/依赖），并做 Dashboard 版本 semver 门控。
- **Loader**（`loader.ts`）：加载插件模块。bundled 用工厂函数，URL 插件用 bundler 无关的运行时 `import()`；提供清单抓取与内容哈希（开发热重载用）。
- **Manager**（`manager.ts`）：生命周期编排（discover → install → activate → deactivate → uninstall），错误隔离，开发模式轮询热重载。
- **Extension Store**（`extension-store.ts`）：以插件 id 标记的贡献集合（菜单/路由/组件/详情区块/工具栏），支持按插件整体移除；提供排序后的 selector hooks。
- **Plugin API**（`api.ts`）：`createPluginApi` 生成传给 `activate` 的 `api`；所有注册被追踪以便强制清理。
- **Sandbox**（`sandbox.ts`）：`createPluginStore` 每插件独立 store（命名空间持久化）。
- **Event Bus**（`event-bus.ts`）：mitt 总线，宿主广播生命周期事件。
- **Host**（`host.ts`）：向 `window.__AGENTTEAMS_DASHBOARD_HOST__` 注入 React/ReactDOM/事件总线。

### 扩展点宿主组件（`src/components/plugins/`）

- `plugin-nav-items.tsx`：侧边栏「插件」分组。
- `plugin-route-view.tsx`：独立页面渲染（section id 形如 `plugin-route:<id>/<routeId>`）。
- `plugin-widgets.tsx`：总览页组件网格。
- `plugin-detail-blocks.tsx`：详情对话框区块。
- `plugin-toolbar-buttons.tsx`：顶栏按钮。
- `plugin-error-boundary.tsx`：包裹每个贡献的错误边界。

## 4. 插件清单（plugin.json）

见开发文档。要点：`entry.dashboard` 必填；`dashboardVersion`/`min_version` 做版本门控；`extensionPoints` 声明后强制执行。

## 5. 加载机制

- **bundled**：编译进 Dashboard，但仍懒加载（动态 import），与 URL 插件走同一套激活流程。示例插件 `src/plugins/monitor-panel/`。
- **url**：运行时 `import(manifestUrl 相对解析出的入口 URL)`。开发模式 Manager 周期性抓取入口、对比哈希，变化则重载（热更新）。
- **发现来源**：内置 bundled 列表 → 已安装 URL（持久化）→ `/api/dashboard/plugins`（扫描 `public/plugins/`）→ 环境变量 `NEXT_PUBLIC_PLUGIN_DEV_URLS`。

## 6. 安全与隔离边界

- **状态**：插件仅能访问 `api.store`（独立实例），无法触及宿主全局 store。
- **渲染**：每个贡献独立错误边界；加载/渲染失败仅影响该插件。
- **激活失败**：捕获异常，清理已注册贡献，标记 `error`，主应用继续运行。
- **图标**：仅接受白名单名称，避免跨边界传递组件/任意代码。
- **当前范围**：`permissions` 为声明式（展示用）；未做 iframe/sandbox 级别的强隔离（见“未来工作”）。

## 7. 与上游生态兼容

清单字段与 AgentTeams 对齐；同一插件包可同时携带 `entry.backend`（Python）与 `entry.dashboard`（JS），Dashboard 仅消费后者。

## 8. 性能

- 插件懒加载，离开首屏关键路径（LCP 目标 ≤ 2.5s）。
- 扩展点 selector 使用稳定引用与 memo，避免无关渲染。

## 9. 未来工作

- 权限执行（按 `permissions` 限制网络/存储访问）。
- 插件市场/集中分发与签名校验。
- 更强的运行时隔离（iframe / shadow realm）与 CSP。
- 插件间依赖解析与拓扑加载。
