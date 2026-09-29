# 需求文档：线上版本热更新与任务看板切换修复

Feature Name: hot-update-nav-fix
Updated: 2026-09-29

## 介绍

两个交付物：

1. **任务看板切换失效修复（真实根因已定位）**：`tasks-section.tsx:523` 调用 `useActiveSection()`，其内部初始解析 effect（`use-active-section.ts:68-70`）在每次挂载时重跑 `resolveInitialSection()` 并把「当前 URL hash 解析结果」写回 store。chat→任务看板切换时 TasksSection 与外壳在同一 commit 内同步挂载（chat 分支绕过 AnimatePresence），子组件 effect 先执行，读到尚未更新的 `#chat` 并把 store 回滚为 `chat`；外壳 hash 同步 effect 随后读到已回滚的值，跳过 `#tasks` 写入。表现为高亮/面包屑无任何变化。非 chat 区块之间切换因 `mode="wait"` 延迟了 TasksSection 挂载（此时 hash 已写好），故无感。
2. **线上版本热更新（按钮式）**：页面提供「检查更新」入口。点击后并行做两项对比：(a) 当前页面构建号 vs 服务器最新构建号（`/api/dashboard-build`），不一致时展示「更新」按钮，点击整页刷新追平新构建；(b) 本仓库 GitHub 最新 release 版本 vs 当前构建内嵌版本，提示「上游有新版本」供运维拉取重建镜像。配套 chunk 加载失败自愈，覆盖页面刷新前请求已失效旧 chunk 的窗口。

## 术语表

- **构建版本 (Build ID)**: `next build` 生成的唯一标识（standalone 产物 `.next/BUILD_ID`），同一次构建的所有实例共享
- **页面构建号 vs 服务器构建号**: 浏览器中已加载页面的 Build ID 与当前容器进程的 Build ID。二者不一致说明镜像已重新部署而页面未刷新
- **chunk 自愈**: 懒加载区块动态 import 失败（旧 chunk 已被新部署清除）时自动整页刷新一次
- **上游 release**: `agentteams-group/agentteams-dashboard` 仓库在 GitHub 上发布的最新版本

## 需求

### Requirement 1: 修复任务看板切换失效

**User Story:** AS 操作者, I want 从 chat 点击「任务看板」首次点击立即生效, so that 看板操作符合直觉

#### Acceptance Criteria

1. The useActiveSection 初始解析 SHALL 在每个应用生命周期内仅执行一次（模块级标记），组件重复挂载时 SHALL 保留 store 当前值
2. WHEN 操作者从任意区块点击侧边栏「任务看板」, the 应用 SHALL 完成切换且侧边栏高亮与面包屑同步更新
3. WHEN 浏览器前进/后退触发 hashchange, the 应用 SHALL 保留现有的深链与回退行为（回归保护）
4. The 修复 SHALL 附带回归测试：模拟「store 已切换到 tasks 且 hash 仍为旧值时 TasksSection 重新挂载」，断言 store 保持 tasks

### Requirement 2: 会话侧栏拖拽监听器清理（防回归加固）

**User Story:** AS 代码维护者, I want chat 会话侧栏拖拽中途切换区块时事件监听器被正确清理, so that 泄漏的 pointermove 监听器不会残留

#### Acceptance Criteria

1. WHEN chat 会话侧栏拖拽（resize）过程中组件被卸载, the 会话侧栏 SHALL 移除其注册在 window 上的全部 pointermove/pointerup 监听器

### Requirement 3: dashboard 构建版本接口

**User Story:** AS 运维人员, I want dashboard 暴露自身构建版本, so that 页面能判断自身是否落后于当前部署

#### Acceptance Criteria

1. The dashboard SHALL 提供只读接口 `GET /api/dashboard-build`，返回当前进程的构建版本标识
2. The 构建版本接口 SHALL 在进程生命周期内缓存读取结果，同一进程的响应值恒定
3. IF 构建版本标识读取失败, the 构建版本接口 SHALL 返回 `buildId: "unknown"` 并仅记录一次告警日志
4. The 构建版本接口 SHALL 免认证且响应体仅包含构建标识与构建时间（零敏感信息）

### Requirement 4: 检查更新入口（按钮式）

**User Story:** AS 长时间打开页面的操作者, I want 主动检查并一键追平最新部署, so that 我使用的功能与线上一致且刷新时机由我掌控

#### Acceptance Criteria

1. The 设置面板 SHALL 提供「检查更新」操作，展示当前页面构建号与构建时间
2. WHEN 用户点击「检查更新」, the 客户端 SHALL 并行请求服务器构建号与 GitHub 最新 release
3. WHEN 页面构建号与服务器构建号不一致, the 客户端 SHALL 展示「发现新版本」与「立即更新」操作
4. WHEN 用户点击「立即更新」, the 客户端 SHALL 执行整页刷新
5. WHEN 页面构建号与服务器构建号一致, the 客户端 SHALL 提示「已是最新版本」
6. IF 服务器构建号不可用, the 客户端 SHALL 提示检查失败并保留重试入口
7. WHEN GitHub 最新 release 版本高于当前构建内嵌版本, the 客户端 SHALL 提示「上游有新版本 vx.y.z，可拉取最新代码重建镜像」
8. WHILE 检查请求进行中, the 客户端 SHALL 展示进行中状态并禁用重复点击

### Requirement 5: Chunk 加载失败自愈

**User Story:** AS 使用旧版本页面的用户, I want 点击已失效资源失败时页面自动恢复, so that 我可以继续工作

#### Acceptance Criteria

1. IF 任一懒加载区块的 chunk 请求失败且当前会话（sessionStorage 标记）尚未自愈过, the 客户端 SHALL 在 3 秒内自动整页刷新一次
2. IF 自愈刷新后再次发生 chunk 请求失败, the 客户端 SHALL 展示现有的区块错误边界卡片并维持现状
3. The chunk 自愈 SHALL 在每次浏览器会话中最多执行一次自动刷新
