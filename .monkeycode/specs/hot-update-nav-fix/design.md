# 线上版本热更新与任务看板切换修复

Feature Name: hot-update-nav-fix
Updated: 2026-09-30（v1.2.5 交付版；升级判定最终定案为版本号门控，构建号降级为展示信息与 legacy 兜底，新增确定性构建号设计）

## Description

生产环境以 docker 镜像运行（`build.yml` 发布预构建镜像）。本设计覆盖三项：

1. **任务看板切换失效**：真实根因为 `useActiveSection()` 的初始解析 effect 随组件挂载重复执行。TasksSection（`tasks-section.tsx:523`）挂载时把「当前 URL hash」重新写回 store——chat→tasks 同 commit 同步挂载路径下读到的 hash 还是旧值 `#chat`，切换被瞬间回滚。修复为模块级 once 标记：初始解析每个应用生命周期只执行一次。
2. **按钮式线上热更新（应用内热补丁）**：设置面板新增「更新」tab——对比页面内嵌版本与服务器版本（`/api/dashboard-build`），不一致则一键刷新追平；同时对比 GitHub 最新 release 与构建内嵌版本。**管理员（L1）可点击「热更新」触发应用内补丁**：后端下载最新 Release 附带的热更新包（`dashboard-hotfix-*.tar.gz`，sha256 校验），热替换应用目录（旧版保留于 `app.prev`），进程退出交由容器监管方（docker restart 策略 / k8s restartPolicy）拉起——无 docker socket、无旁路容器，docker 与 k8s 行为一致；页面轮询 `/api/dashboard-build` 直到**版本号**变化后自动 reload。配套 chunk 自愈覆盖刷新前旧资源失效窗口。
3. **构建号确定性**：Turbopack 的 client/server 编译 worker 各自独立加载 `next.config.ts`，模块级时间戳会被求值两次，导致一次构建产生两个构建号（客户端内联 vs `.next/BUILD_ID` 文件）——这是线上「页面/服务器构建号永久分裂」误报的真凶。修复为三级回退的确定性生成：`DASHBOARD_BUILD_ID` env → git short sha → `.next/.build-id-lock` 锁文件，任意加载路径得到同一值。

时序图（bug 机理与修复后对照）：

```mermaid
sequenceDiagram
    participant U as 操作者
    participant S as 外壳 hash 同步 effect
    participant T as TasksSection 挂载 effect
    participant St as section store
    Note over U,St: 修复前（chat→tasks，chunk 已缓存）
    U->>St: setActiveSection('tasks')
    Note over T: 同一 commit，子 effect 先跑
    T->>St: 读 hash '#chat' → setActiveSection('chat') 回滚
    S->>S: 读 live store='chat'，与 hash 一致 → 跳过写 #tasks
    Note over U,St: 修复后
    U->>St: setActiveSection('tasks')
    T->>T: once 标记已置位 → 保留 'tasks'
    S->>St: 写 hash '#tasks'
```

## Architecture

```mermaid
graph TD
    A["next build (CI)"] --> B["resolveBuildId: DASHBOARD_BUILD_ID env / git sha / lock file"]
    B --> C["standalone .next/BUILD_ID + 客户端内嵌（同值）"]
    C --> D["build.yml 打包镜像（--build-arg DASHBOARD_BUILD_ID=VERSION）"]
    D --> E["docker 部署新容器"]
    E --> F["GET /api/dashboard-build（buildId + version + builtAt）"]
    F --> G["lib/build-id.ts 进程内缓存"]
    P["浏览器页面 (设置面板)"] -->|"点击 检查更新"| F
    P -->|"点击 检查更新"| H["GitHub releases/latest"]
    F -->|"版本号不同 或 legacy buildId 不同"| I["发现新版本 → 立即更新"]
    F -->|"版本号相同"| J["已是最新（构建号仅展示）"]
    H -->|"release 高于内嵌版本 + L1"| K["热更新按钮"]
    K -->|"POST /api/self-update (L1 门禁)"| W["lib/hotfix: 下载→sha256 校验→热替换 appDir→进程强杀（SIGTERM→SIGKILL→exit）"]
    W -->|"监管方拉起新进程"| E
    I -->|"点击 立即更新"| L["bustingReload: ?_b=时间戳 穿透缓存刷新"]
    P -->|"轮询 version 直到变化 → bustingReload"| F
    M["SectionErrorBoundary 捕获 chunk 失败"] -->|"会话内首次"| L
    M -->|"已自愈"| N["错误边界卡片"]
```

## Components and Interfaces

| 组件 | 文件 | 职责 |
|------|------|------|
| 初始解析 once 化 | `src/components/dashboard/use-active-section.ts` (修复) | 模块级 `initialResolutionDone` 标记，挂载 effect 仅首置位生效 |
| 回归测试 | `src/components/dashboard/use-active-section.test.ts` (扩展) | 复现并锁定：remount 不回滚 store |
| 侧栏拖拽清理 | `src/components/dashboard/sections/chat/chat-room-sidebar.tsx` (修复) | resize 处理器入 ref，卸载统一移除 |
| 构建版本读取器 | `src/lib/build-id.ts` (新增) | 读 `.next/BUILD_ID` 一次并缓存；失败返回 `'unknown'` 仅告警一次 |
| 构建版本接口 | `src/app/api/dashboard-build/route.ts` (新增) | `GET` → `200 { buildId, version, builtAt }`，免认证，`Cache-Control: no-store` |
| 检查更新 Hook | `src/hooks/use-update-check.ts` (新增) | 并行取服务器构建版本与 GitHub release，状态机 idle/checking/uptodate/update-available/upstream-available/error |
| 检查更新 UI | 设置面板新增「更新」tab (`settings-dialog.tsx`) | 当前构建信息 + 检查更新按钮 + 各状态提示 |
| chunk 自愈 | `src/components/dashboard/section-error-boundary.tsx` (增强) | 识别 chunk 类错误，会话内首次延迟 ~1.5s 刷新 |
| 热更新触发 | `src/app/api/self-update/route.ts` (新增) | L1 门禁（session.level≥3），取最新 Release → 版本门禁 → `lib/hotfix.applyHotfix` → 审计 → 响应后强杀进程（SIGTERM→SIGKILL→exit 三级）交监管方重启 |
| 热补丁执行器 | `src/lib/hotfix.ts` (新增) | 资产选择（`dashboard-hotfix-*` 前缀）、限流下载（800MB 上限）、sha256 校验、tar 解包 + server.js/BUILD_ID 完整性检查、目录原子换装（旧版留 `app.prev`）、并发防重入 |
| 容器更新流 | `src/hooks/use-update-check.ts` (扩展) | `updateContainer()`: 触发后轮询 `/api/dashboard-build`（2s 间隔，5min 上限），容器重启期的连接失败静默重试，**版本号**变化即 bustingReload；超时报错 |
| 构建号确定性 | `next.config.ts` resolveBuildId() (新增) | DASHBOARD_BUILD_ID env → git short sha → `.next/.build-id-lock`（10min），配置的每次加载得到同一值 |
| 补丁包构建 | `scripts/build-hotfix-bundle.sh` (新增) | 发布期打包 standalone+public+static 为 tar.gz + sha256，上传为 Release assets |

### 接口定义

```ts
// GET /api/dashboard-build → 200（Cache-Control: no-store）
{ "buildId": "git-7e0f285", "builtAt": "2026-09-30T05:43:00Z", "version": "1.2.5" }

// src/lib/version.ts（共享工具）
export function compareSemver(a: string, b: string): number  // 三段比较，v 前缀容错，预发行按 0

// src/hooks/use-update-check.ts（最终形态）
type UpdateCheckState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'error'; message: string }
  | { phase: 'uptodate' }
  | { phase: 'update-available'; serverBuildId: string; serverVersion: string; builtAt?: string }
  | { phase: 'upstream-available'; latestVersion: string; serverBuildId: string; builtAt?: string };
export function useUpdateCheck(): { state: UpdateCheckState; check: () => void; applyUpdate: () => void; updateContainer: () => void }
// check(): 并行 GET /api/dashboard-build 与 GitHub releases/latest（10s 超时）
//   服务器返回 version 时：版本号相同 → uptodate（构建号差异不提示）；不同 → update-available
//   服务器无 version（legacy）：回退 buildId 比对，不同 → update-available
//   GitHub 对比基准 = 构建时内嵌 package.json version（compareSemver 三段）
// applyUpdate(): bustingReload——location.replace(`${pathname}?_b=${Date.now()}`) 穿透反代缓存
// updateContainer(): POST /api/self-update → 轮询 /api/dashboard-build 直至 version 变化 → bustingReload（5min 超时）

// section-error-boundary 自愈
// 识别：error.name === 'ChunkLoadError' 或 message 含 'Failed to fetch dynamically imported module'
// 流程：sessionStorage['agentteams-chunk-heal'] 未置位 → 置位 → 1.5s 后 reload
//      已置位 → 现有错误卡片（现状行为）
```

版本内嵌方案：`next.config.ts` 在单次构建内求值一次构建号（`resolveBuildId()` 确定性生成），经 `env` 在构建期写入 `NEXT_PUBLIC_BUILD_ID`（客户端内嵌）、`NEXT_PUBLIC_BUILD_ID` 同时供 `/api/dashboard-build` 读取、`NEXT_PUBLIC_APP_VERSION`（package.json 版本）与 `NEXT_PUBLIC_BUILT_AT`；服务器构建号运行时读 `.next/BUILD_ID` 文件。确定性保证客户端内嵌值与服务端文件值严格同源同值。

## Data Models

- **API 响应**: `{ buildId: string; version: string; builtAt?: string }`（builtAt 取 BUILD_ID 文件 mtime 的 ISO 串，读取失败则缺省）
- **sessionStorage**: `agentteams-chunk-heal = '1'`
- **Hook 状态机**: 见上方 `UpdateCheckState`，全部内存态
- **use-active-section**: 模块级 `let initialResolutionDone = false`，纯内存

## Correctness Properties

1. 初始解析每应用生命周期至多执行一次；组件任意次重挂载均保留 store 当前值
2. hashchange 深链/前进后退行为与现状完全一致（既有测试全绿）
3. 同一进程生命周期内 `/api/dashboard-build` 响应恒定
4. chunk 自愈自动刷新每会话至多一次
5. 版本接口/GitHub 不可用时，「检查更新」提示失败并保留重试，页面其余功能零影响
6. 侧栏拖拽中卸载组件后，window 上无残留 pointermove/pointerup 监听器

## Error Handling

| 场景 | 处理 |
|------|------|
| `.next/BUILD_ID` 读取失败 | `buildId='unknown'`，服务端单次 warn |
| 页面构建号 vs 服务器均为 unknown | 视为一致，提示已是最新（避免 unknown≠unknown 误报） |
| GitHub API 限流/网络失败 | 上游对比结果标记为不可用，服务器构建号对比结果照常展示 |
| 检查请求超时（10s） | `phase='error'`，展示重试入口 |
| 自愈刷新后仍 chunk 失败 | 现有错误边界卡片，等待人工刷新或下次部署 |
| 更新器未配置/无热更新包 | Release 缺 `dashboard-hotfix-*` 资产时路由返回 404，提示走镜像部署 |
| 非 L1 用户触发 | 路由返回 403，UI 隐藏「热更新」按钮 |
| sha256 校验失败 | 中止且运行中版本零改动（staging 清理） |
| 应用目录不可写（k8s readOnlyRootFilesystem） | 明确报错并提示放开只读限制 |
| 热更新期间连接失败 | 属预期（进程重启中），轮询静默重试直至 version 变化或超时 |
| 更新超时（5min 内 version 未变化） | UI 报「更新超时」并提示检查容器状态 |
| 容器未配重启策略 | 进程退出后无人拉起——部署契约：docker `--restart unless-stopped` / k8s `restartPolicy: Always`（安装器默认内置） |
| 重复触发 | 防重入守卫返回 409「热更新进行中」 |
| 补丁在 Pod 重建后丢失 | 预期语义：热补丁是快速通道，下一次镜像构建包含同样代码后自然收敛 |
| 拖拽中切走 chat 区块 | 卸载清理函数移除 window 监听器 |

## Test Strategy

**单元测试（vitest）**

1. `use-active-section.test.ts` 扩展：置 hash='#chat' + store='chat' → 切 store 到 'tasks' → 重挂载 useActiveSection → 断言 store 保持 'tasks'（修复前该用例红，修复后绿）；既有 9 个用例保持全绿
2. `build-id.test.ts`：正常读取、缓存命中、异常返回 unknown 仅一次告警
3. `use-update-check.test.ts`：状态机迁移——checking/uptodate/update-available/upstream-available/error；版本号门控（同版本构建号不同 → uptodate）；legacy 兜底（服务器无 version → buildId 比对）；bustingReload 携带 `?_b=` 参数；updateContainer 轮询到 version 变化后 reload、超时路径
4. `hotfix.test.ts`：真实 tar 文件保真测试（资产选择、sha256 校验失败零改动、原子换装与 app.prev、server.js/BUILD_ID 完整性、防重入）
5. `self-update route.test.ts`：L1 门禁 403、Release 缺补丁 404、版本门禁、热应用后强杀
6. `dashboard-build route.test.ts`：200 形状（含 version）、`no-store` 响应头、连续请求稳定
7. `section-error-boundary.test.ts`：chunk 错误 + 会话首次 → reload 一次；已置位 → 错误卡片；非 chunk 错误 → 现状
8. `chat-room-sidebar.test.ts`：拖拽中卸载 → removeEventListener 调用（spy）

**人工验收**

1. dev 与生产构建下连续 10 次「chat→任务看板」首点全部生效（含 chunk 已缓存场景）
2. 部署新镜像后：旧页面打开设置 → 检查更新 → 出现「发现新版本」→ 点击更新 → 页面追平
3. 构建号确定性：`cat .next/BUILD_ID` 与 `grep -rhoE "git-[0-9a-f]{7,10}" .next/static/chunks .next/server | sort -u` 必须单一值
4. 浏览器前进/后退深链行为抽查

## References

[^1]: (Filename#L68) - 初始解析 effect（根因点）: `src/components/dashboard/use-active-section.ts`
[^2]: (Filename#L523) - TasksSection 对 useActiveSection 的调用: `src/components/dashboard/sections/tasks-section.tsx`
[^3]: (Filename#L278) - resize 监听器泄漏点: `src/components/dashboard/sections/chat/chat-room-sidebar.tsx`
[^4]: (Filename) - 镜像发布触发条件: `.github/workflows/build.yml`
[^5]: (Filename) - 设置面板挂载点: `src/components/dashboard/settings-dialog.tsx`
[^6]: (Filename) - 构建号确定性生成: `next.config.ts` resolveBuildId()
[^7]: (Filename) - 发版规范: `docs/RELEASE.md`
