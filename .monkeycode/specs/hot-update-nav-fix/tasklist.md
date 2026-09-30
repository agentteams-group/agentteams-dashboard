# 任务列表：线上版本热更新与任务看板切换修复

Feature Name: hot-update-nav-fix
Closed: 2026-09-30（v1.2.5 正式版收口，全部任务完成）

## 1. 任务看板切换失效修复

- [x] `use-active-section.ts` 初始解析 effect 模块级 once 化（`initialResolutionDone` 标记），组件重挂载不回滚 store
- [x] `chat-room-sidebar.tsx` resize 监听器入 ref，卸载统一移除 pointermove/pointerup
- [x] 回归测试：hash='#chat' + store 切 tasks + TasksSection 重挂载 → store 保持 tasks（红→绿）；既有用例全绿
- [x] renderHook 测试显式 afterEach(cleanup)（vitest globals 未开导致跨用例污染的坑）
- 提交：`410018a`

## 2. 构建版本接口与检查更新

- [x] `src/lib/build-id.ts`：`.next/BUILD_ID` 进程内缓存 + mtime，失败 `'unknown'` 单次告警
- [x] `GET /api/dashboard-build`：免认证，返回 `{ buildId, version, builtAt }`，`Cache-Control: no-store`
- [x] `use-update-check.ts` 状态机：idle/checking/uptodate/update-available/upstream-available/error
- [x] 设置面板「更新」tab：构建信息展示 + 检查更新 + 各状态提示
- [x] `section-error-boundary.tsx` chunk 自愈（sessionStorage 一次）
- 提交：`9b64f5b`

## 3. 应用内热补丁通道

- [x] `src/lib/hotfix.ts`：资产选择（`dashboard-hotfix-*`）、800MB 限流下载、sha256 校验、tar 解包 + server.js/BUILD_ID 完整性、原子换装（`app.prev`）、claim/release 防重入
- [x] `POST /api/self-update`：L1 门禁（403）→ Release 缺包 404 → 版本门禁 → applyHotfix → 审计 → 强杀进程（SIGTERM→SIGKILL→exit 三级）
- [x] `scripts/build-hotfix-bundle.sh`：发布期打包（standalone+public+static）+ sha256
- [x] watchtower 旁路容器方案试水后完整回退（docker socket 侵入性 + k8s 不兼容），回归应用内补丁
- [x] `docs/RELEASE.md` 发版规范 + `.monkeycode/MEMORY.md` 要点索引
- 提交：`696d119`（回退）、`2b0dd07`、`91dab8c`、`d293e53`、`3954d79`、`9f341e1`

## 4. 构建号确定性修复（根因闭环）

- [x] 本地实验实锤：一次构建内客户端内联 `dash-munn9pqv` vs 服务端文件 `dash-munn9p1x`（Turbopack client/server worker 独立加载 next.config，时间戳被求值两次）
- [x] `next.config.ts` resolveBuildId()：DASHBOARD_BUILD_ID env → git short sha → `.next/.build-id-lock`（10min）
- [x] `Dockerfile` ARG/ENV 透传；`build.yml` 注入 `--build-arg DASHBOARD_BUILD_ID=${VERSION}`
- [x] 验证法沉淀：`cat .next/BUILD_ID` 与 chunk/server grep 必须单一值
- 提交：`e7f4c45`、`7e0f285`（修复构建期暴露的重复 import）

## 5. 版本号门控（升级语义定案）

- [x] 用户定案：同版本不同构建号视为「已是最新」（零横幅），仅真实版本差异提示「发现新版本」
- [x] hook 状态机改版：server version 存在 → 版本比对；legacy（无 version 字段）→ buildId 兜底
- [x] 完成轮询从 buildId 变化改为 version 变化
- [x] UI：单版本横幅「发现新版本 v{serverVersion}」，移除同版本蓝条
- 提交：`e7f4c45`

## 6. 发版收口

- [x] beta.1-beta.5 迭代（每次 bump/tag/release/bundle/upload，验证热更新链路）
- [x] 门禁教训沉淀：next.config.ts 改动必跑 tsc（tsconfig include 含 **/*.ts），gh release upload 后台执行
- [x] MEMORY.md 经验条目
- [x] v1.2.5 正式版：CHANGELOG、版本三方一致、Release 正式可见 + hotfix assets
