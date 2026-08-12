# AgentTeams Dashboard 插件开发指南

本文档介绍如何为 AgentTeams Dashboard 开发、调试和发布插件。插件机制允许第三方开发者在**不修改核心代码**的前提下扩展 Dashboard 功能，并能与上游保持同步更新。

> 英文版见 [plugin-development.md](./plugin-development.md)。

## 目录

1. [核心概念](#核心概念)
2. [快速开始](#快速开始)
3. [插件清单 plugin.json](#插件清单-pluginjson)
4. [扩展点](#扩展点)
5. [插件 API 参考](#插件-api-参考)
6. [状态隔离与事件通信](#状态隔离与事件通信)
7. [动态加载与错误边界](#动态加载与错误边界)
8. [开发调试与热更新](#开发调试与热更新)
9. [发布流程](#发布流程)
10. [与 AgentTeams 上游插件生态的兼容](#与-agentteams-上游插件生态的兼容)
11. [最佳实践](#最佳实践)

---

## 核心概念

- **插件（Plugin）**：一个包含 `plugin.json` 清单和一个 ES 模块入口的独立项目。入口模块导出 `activate(api)`（以及可选的 `deactivate()`）。
- **扩展点（Extension Point）**：Dashboard 中允许插件注入 UI 的固定位置，共 5 类：侧边栏菜单、独立页面、仪表盘组件、详情面板区块、工具栏按钮。
- **插件 API（Plugin API）**：`activate(api)` 收到的 `api` 对象，是插件与 Dashboard 交互的唯一入口，提供注册方法、事件总线、隔离状态、HTTP 封装与集群数据服务。
- **注册表（Registry）**：Dashboard 内部维护插件的安装/启用/禁用/卸载状态与元数据。
- **加载器（Loader）**：运行时通过动态 `import()` 按需加载插件模块（不使用 Module Federation，无需额外构建配置）。

### 生命周期

```
安装 install → 激活 activate → (渲染) → 停用 deactivate → 卸载 uninstall
```

- **安装**：Dashboard 读取并校验 `plugin.json`，登记到注册表。
- **激活**：加载入口模块并调用 `activate(api)`；插件在此注册各类扩展。
- **停用/禁用**：调用 `deactivate()`，并强制清理该插件的全部扩展贡献。
- **卸载**：停用并从注册表移除，同时清理其持久化状态。

---

## 快速开始

使用脚手架一键生成插件项目：

```bash
# 在 agentteams-dashboard 仓库根目录
node tools/create-dashboard-plugin/bin/cli.js my-plugin

# 或发布后使用 npm
npm create dashboard-plugin my-plugin
```

生成的项目结构：

```
my-plugin/
├─ package.json
├─ vite.config.mjs             # 开发/构建配置
├─ vite-plugin-host-react.mjs  # 将 react 解析到宿主实例
├─ public/plugin.json          # 插件清单
└─ src/main.jsx                # 入口：activate/deactivate
```

启动开发服务器并接入 Dashboard：

```bash
cd my-plugin
npm install
npm run dev        # http://localhost:5173
```

在 Dashboard「设置 → 插件 → 从 URL 安装」填入 `http://localhost:5173/plugin.json`，点击安装即可。侧边栏会出现插件菜单项，总览页会出现示例组件。

> 也可以通过环境变量注入开发插件（逗号分隔多个）：
> `NEXT_PUBLIC_PLUGIN_DEV_URLS=http://localhost:5173/plugin.json`

---

## 插件清单 plugin.json

```json
{
  "apiVersion": "dashboard.agentteams/v1",
  "kind": "DashboardPlugin",
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "插件描述",
  "author": "Your Name",
  "entry": { "dashboard": "src/main.jsx" },
  "dashboardVersion": ">=0.2.0",
  "extensionPoints": ["sidebar-menu", "route", "dashboard-widget"],
  "permissions": ["network"]
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 插件唯一标识，仅允许小写字母、数字、`-`、`_` |
| `name` | 是 | 展示名称 |
| `version` | 是 | 语义化版本（如 `1.0.0`） |
| `entry.dashboard` | 是 | Dashboard 侧 ES 模块入口（相对清单的路径或完整 URL） |
| `entry.backend` | 否 | 上游 AgentTeams 后端入口（Dashboard 忽略，仅用于生态兼容） |
| `dashboardVersion` | 否 | 兼容的 Dashboard 版本范围（semver），如 `>=0.2.0`、`^0.2.0`、`0.x` |
| `min_version` | 否 | 上游风格字段，等价于 `>=min_version`；与 `dashboardVersion` 同时存在时优先后者 |
| `extensionPoints` | 否 | 声明使用的扩展点；若声明，则只能使用已声明的扩展点 |
| `permissions` | 否 | 声明式权限列表（当前版本仅作信息展示） |
| `dependencies` | 否 | 依赖的其他插件 id 列表 |

**版本校验**：安装时 Dashboard 会用自身版本匹配 `dashboardVersion`/`min_version`，不满足则拒绝安装并给出提示。

---

## 扩展点

Dashboard 提供 5 类扩展点。插件通过 `api.register*` 方法注入内容。

| 扩展点 | 注册方法 | 位置 |
| --- | --- | --- |
| `sidebar-menu` | `api.registerMenuItem` | 侧边栏「插件」分组 |
| `route` | `api.registerRoute` | 独立页面（主内容区） |
| `dashboard-widget` | `api.registerWidget` | 总览页组件网格 |
| `detail-panel` | `api.registerDetailBlock` | 实体详情对话框（如 Worker 详情） |
| `toolbar` | `api.registerToolbarButton` | 顶部工具栏 |

### 侧边栏菜单（sidebar-menu）

```js
api.registerMenuItem({
  id: 'home',
  label: '我的页面',
  icon: 'sparkles',                    // 图标名（见下方白名单）
  target: { type: 'plugin-route', routeId: 'home' },  // 打开插件页面
  order: 10,
});
```

`target` 支持三种跳转：

- `{ type: 'plugin-route', routeId }`：打开本插件注册的页面；
- `{ type: 'section', sectionId }`：跳转到 Dashboard 内置 section（如 `overview`、`workers`）；
- `{ type: 'href', url }`：在新标签页打开外部链接。

### 独立页面（route）

```jsx
api.registerRoute({
  id: 'home',
  title: '我的页面',
  component: MyPage,   // React 组件
});
```

### 仪表盘组件（dashboard-widget）

```jsx
api.registerWidget({
  id: 'status',
  title: '状态卡片',
  component: StatusCard,
  size: 'md',          // 'sm' | 'md' | 'lg'
  order: 1,
});
```

### 详情面板区块（detail-panel）

```jsx
api.registerDetailBlock({
  id: 'extra',
  entity: 'worker',    // 'worker' | 'team' | 'manager' | 'human'
  component: WorkerExtra,
});
```

组件会收到 `{ entity }` 属性，即当前实体对象（如 Worker 详情数据）。

### 工具栏按钮（toolbar）

```jsx
api.registerToolbarButton({
  id: 'ping',
  label: '打个招呼',
  icon: 'zap',
  onClick: () => api.dashboard.toast('Hello!', 'success'),
});
```

也可以提供 `component` 渲染完全自定义的按钮。

### 图标白名单

菜单/按钮的 `icon` 字段使用名称字符串（跨序列化边界，不能传组件）。可用名称包括：`activity`、`alert`、`archive`、`bar-chart`、`bell`、`book`、`bot`、`box`、`brain`、`check`、`clipboard`、`clock`、`cloud`、`cpu`、`database`、`eye`、`file`、`flag`、`gauge`、`git-branch`、`globe`、`heart`、`home`、`info`、`layers`、`layout-dashboard`、`link`、`list`、`lock`、`mail`、`map`、`message-square`、`network`、`package`、`pie-chart`、`plug`、`puzzle`、`rocket`、`rss`、`search`、`server`、`settings`、`shield`、`sparkles`、`star`、`target`、`terminal`、`trending-up`、`upload`、`user`、`users`、`wifi`、`wrench`、`zap`。未知名称回退为拼图图标。

---

## 插件 API 参考

`activate(api)` 的 `api` 对象包含以下成员：

### 身份字段

| 字段 | 说明 |
| --- | --- |
| `api.pluginId` | 当前插件 id |
| `api.dashboardVersion` | 宿主 Dashboard 版本 |
| `api.pluginApiVersion` | 插件 API 版本（当前为 `1`） |

### 注册方法

每个方法返回一个 `unregister` 函数，调用后移除该贡献（停用/卸载时宿主也会强制清理）。

- `api.registerMenuItem(item) → unregister`
- `api.registerRoute(route) → unregister`
- `api.registerWidget(widget) → unregister`
- `api.registerDetailBlock(block) → unregister`
- `api.registerToolbarButton(button) → unregister`
- `api.registerComponent(point, contribution) → unregister`：按扩展点 id 通用分发。

### 事件总线 `api.events`

基于 [mitt](https://github.com/developit/mitt) 的轻量事件总线，所有插件与宿主共享，可用于插件间通信。

- `api.events.on(event, handler) → unregister`
- `api.events.off(event, handler)`
- `api.events.emit(event, payload)`

约定：插件自身事件使用 `<plugin-id>:<event>` 命名空间。宿主会广播以下生命周期事件：

| 事件 | 负载 |
| --- | --- |
| `host:plugin-activated` | `{ pluginId }` |
| `host:plugin-deactivated` | `{ pluginId }` |
| `host:plugin-error` | `{ pluginId, error }` |
| `host:section-changed` | `{ sectionId }` |

### 隔离状态 `api.store`

每个插件拥有独立的 Zustand store（按插件 id 命名空间持久化到 localStorage），互不干扰。

- `api.store.getState() → object`
- `api.store.setState(partial)`
- `api.store.subscribe(listener) → unsubscribe`

### HTTP 封装 `api.http`

自动附带 Dashboard basePath 与同源凭证。

- `api.http.fetch(path, init) → Promise<Response>`
- `api.http.get<T>(path) → Promise<T>`
- `api.http.post<T>(path, body?) → Promise<T>`

### 集群数据与交互 `api.dashboard`

- `api.dashboard.navigate(sectionId)`：跳转到内置 section 或插件页面（`plugin-route:<id>/<routeId>`）。
- `api.dashboard.toast(message, type?)`：弹出提示（`info`/`success`/`warning`/`error`）。
- `api.dashboard.getClusterStatus()`：集群状态（`totalWorkers`、`totalTeams`、`totalHumans`、`kubeMode` 等）。
- `api.dashboard.getVersion()`：Controller/Dashboard 版本信息。
- `api.dashboard.listWorkers()` / `listTeams()` / `listManagers()` / `listHumans()`：实体列表。

### 日志 `api.log`

- `api.log.info/warn/error(...args)`：带 `[plugin:<id>]` 前缀。

---

## 状态隔离与事件通信

- **状态隔离**：`api.store` 是独立 store 实例，插件无法访问宿主或其他插件的 store，避免全局状态污染。持久化 key 形如 `agentteams-plugin-state:<id>`。
- **React 单实例**：插件与宿主共享同一个 React 实例（宿主在 `window.__AGENTTEAMS_DASHBOARD_HOST__` 暴露 React/ReactDOM）。脚手架通过 `vite-plugin-host-react.mjs` 把 `react`/`react-dom`/`react/jsx-runtime` 解析到宿主实例，保证 Hooks/Context 正常工作。**请勿把 React 打包进插件产物。**
- **事件通信**：跨插件/跨宿主通信统一走 `api.events`。

---

## 动态加载与错误边界

- **按需加载**：插件入口通过运行时动态 `import()` 加载（bundled 插件同样懒加载），不进入首屏关键路径，保证首屏性能（LCP 目标 ≤ 2.5s）。
- **错误边界**：每个插件贡献的渲染都被独立的错误边界包裹。插件加载失败或渲染抛错时，仅该插件显示错误提示，**Dashboard 主界面不受影响**。注册表会把该插件标记为 `error` 并记录原因，可在「设置 → 插件」查看。
- **失败隔离**：`activate` 抛错时，宿主会清理该插件已注册的部分贡献，避免残留。

---

## 开发调试与热更新

1. `npm run dev` 启动插件开发服务器（默认 `http://localhost:5173`，已开启 CORS）。
2. 在 Dashboard 安装该插件清单 URL。
3. 修改 `src/main.jsx` 保存后，Dashboard **开发模式**会轮询插件入口，检测到内容变化自动重新加载插件（无需手动刷新页面）。

> 生产构建：`npm run build` 输出 `dist/main.js`（ES 模块）。将其与 `plugin.json`（`entry.dashboard` 指向 `dist/main.js`）部署到静态服务器，再安装清单 URL 即可。

---

## 发布流程

1. **开发自测**：`npm run dev` + Dashboard 联调。
2. **构建产物**：`npm run build`，得到 `dist/main.js`。
3. **部署清单与产物**：把 `plugin.json` 和 `dist/` 部署到任意可访问的静态服务器（或对象存储）。确保 `plugin.json` 的 `entry.dashboard` 指向产物路径。
4. **安装**：用户在 Dashboard「设置 → 插件 → 从 URL 安装」填入清单 URL；或运维通过 `NEXT_PUBLIC_PLUGIN_DEV_URLS`/注册表预置。
5. **版本升级**：更新 `plugin.json` 的 `version` 与产物，重新部署；必要时在 Dashboard 重新加载插件。

---

## 与 AgentTeams 上游插件生态的兼容

Dashboard 插件清单与上游 [AgentTeams](https://github.com/agentscope-ai/AgentTeams) 的插件字段对齐（`id`/`name`/`version`/`description`/`author`/`entry`/`dependencies`/`min_version`）。同一个插件包可以同时携带：

- `entry.backend`：AgentTeams 后端（Python）入口；
- `entry.dashboard`：Dashboard 前端（JS）入口。

Dashboard 只消费 `entry.dashboard`，忽略 `entry.backend`，从而复用同一套插件生态与分发渠道。

---

## 最佳实践

1. **始终通过 `api` 访问数据**，不要 import Dashboard 内部模块，保证插件独立性与上游同步能力。
2. **组件保持轻量**，避免在总览页组件里做重计算或高频轮询。
3. **在 `deactivate` 中清理副作用**（定时器、订阅）；`unregister` 已由宿主兜底，但显式清理更稳妥。
4. **使用 `extensionPoints` 声明用到的扩展点**，便于审阅与权限管理。
5. **事件命名加插件前缀**（`my-plugin:*`），避免与其他插件冲突。
6. **不要打包 React**，复用宿主实例，避免 Hooks 失效与体积膨胀。
7. **为 `dashboardVersion` 设置合理范围**，避免在不兼容版本上加载。
8. **优雅处理数据加载失败**，组件内部捕获异常，绝不让插件崩溃影响主界面。
