# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent while performing [specific task description] should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[User Instruction Summary]
- Date: 2026-08-11
- Context: PR patch 应用后项目梳理阶段
- Instructions:
  - 主题系统验证后自动执行项目文档整理和僵尸文件清理
  - 使用中文交流
  - 保持 main 分支干净，每次变更前需验证 typecheck/lint/test

[Project Knowledge Summary]
- Date: 2026-08-16
- Context: 整体 review 后执行死代码清理
- Category: Workflow & Collaboration
- Instructions:
  - .monkeycode/docs/ 目录是 Agent 内部知识源，docs/ 目录是用户可见文档
  - 已完成的任务书应归档到 .monkeycode/specs/{feature-name}/task-book.md
  - 2026-08-11 计划清理的 skills-section.tsx 已删除；2026-08-16 又删除了 policy-engine/policy-store/remediation-engine（313 行孤立引用环）、a2ui/index.ts barrel、src/app/api/route.ts 残留、team-create-dialog.test.ts 重复测试
  - 仍存在 ensure-ai 三重死链（middleware PUBLIC_PATHS 条目 + agentteams-api.ts 的 ensureAiGateway + integration 测试引用），路由本身不存在，待后续清理
  - 旧条 "GET /api/agentteams/audit 是 admin-only" 已于 2026-09-07 升级为 L2 自审 / L3 全审模型，详见下方 09-07 条目

[User Instruction Summary]
- Date: 2026-10-15
- Context: #146 缺口 2/3 修复验证阶段
- Instructions:
  - 不要运行对接/集成测试（`test:integration` 等需要真实上游或网络的用例）；验证只用 tsc --noEmit + eslint（改动文件）+ 目标单测

[Project Knowledge Summary]
- Date: 2026-08-21
- Context: 修改 Beta 设置与 Overview 运行信息面板时执行构建验证
- Category: Build Methods | Testing Methods
- Instructions:
  - typecheck 必须用 ./node_modules/.bin/tsc --noEmit 或 npm run typecheck；直接 npx tsc 会误装废弃的 tsc@2.0.4 包报错
  - vitest 4 已移除 --reporter=basic，直接运行 ./node_modules/.bin/vitest run 或 npm test
  - 验证顺序：typecheck -> eslint（仅改动的文件）-> vitest run（全量 129 文件约 3 分钟）
  - 组件测试 flake：React 被动 effect（如按 config 变化清空编辑态）可能晚于 screen.findByText 返回才 flush，落在该窗口内的 fireEvent.change 会被随后的重置擦掉，导致保存按钮保持 disabled、点击空转。渲染 + 等表单就绪后先 `await act(async () => {})` 冲掉挂起 effect 再交互，比加大 asyncUtilTimeout 可靠（2026-10-16 修 worker-runtime-config 用例 ⑥）

[Project Knowledge Summary]
- Date: 2026-08-25
- Context: 推进服务端治理 + ChatRoom 重构时落定的项目约定
- Category: Operations & Deployment | Environment Configuration | Workflow & Collaboration
- Instructions:
  - 服务端审计默认落 `${cwd}/logs/audit.log.jsonl`，生产部署必须通过 `AGENTTEAMS_AUDIT_LOG_PATH` 指向持久化卷（默认路径已加入 `.gitignore` `/logs/`）。rotate 策略：单文件 ≥10 MB 或每日触发；归档保留 30 份
  - 写操作路由的 RBAC 现在服务端强制：workers/teams/managers/humans 的 POST/PUT/DELETE/wake/sleep/ensure-ready 走 `enforceServerSideRbac`（带 accessibleWorkers/accessibleTeams 范围检查）；storage/skills/projects/gateway/debug-log/wen-tian/mcps/worker 文件/team 文件 等全局资源走 `enforceLevelOnlyRbac`（纯等级判断）。两类 403 都自动写 warning 审计
  - middleware 在 Higress session 验证通过后注入 `x-agentteams-user` / `x-agentteams-user-level`，proxy-helper 透传给 Controller。修改相关代码时记得：identity 头来自 middleware 不是浏览器，不要直接 `request.headers.get('authorization')` 当成 user 头
  - `recordToolCalls(workerName, eventId, blockCount, now?, structuredKeys?)` 第 5 个参数 `structuredKeys` 是 v1 协议（`org.agentteams.run`）结构化 tool_call 的 id 列表。传入时跳过 event-delta 计数，仅按 id 去重。纯 v0/无结构化数据时维持原 eventId 增量语义
  - `usePersistedDraft(roomId)` 暴露 `setValueLocal`（不写 storage）专供 edit session 回填——直接用 `setValue` 会把编辑中的内容持久化，下次进房间会看到。ChatRoom.tsx 的 handleRequestEditLast / handleCancelEdit 都用 setValueLocal
  - feature-implementer skill 要求每个 task 完成后停下来等用户确认，不要自动推进下一 task。本次按此规范逐项推进 P0-1 / P0-2 / P1-4 Phase1 / RBAC 扩展 / 审计 viewer，每项独立 commit + 验证
  - PR 风格沿用项目约定：标题 `type(scope): summary`，正文包含验证证据（vitest 数字）、兼容性声明、风险与关注点
  - `GET /api/agentteams/audit` 旧版 admin-only 入口已被 2026-09-07 升级版覆盖（L2 自审 / L3 全审，详见下方 09-07 条目）；前端 `useAuditEvents` hook 把 403 当 data 返回而非抛错，UI 走 inline notice 分支渲染"需要审计权限"
   - 仍未接 RBAC 的写路由：`/api/agentteams/setup/*`（装机入口必须在 RBAC 前可达）、`/api/agentteams/packages/*`（由 Controller 侧 gate）、`/api/agentteams/models/probe`（只读）；所有 GET 路由保持开放

[Project Knowledge Summary]
- Date: 2026-09-03
- Context: 实现总览 HITL 收件箱功能（对照 2026 竞品趋势）
- Category: Build Methods | Testing Methods | Workflow & Collaboration
- Instructions:
  - HITL 收件箱核心模块：`src/lib/hitl-inbox.ts`（zustand store + Matrix 事件提取），支持 Tool Guard 文本协议 + v1 `org.agentteams.run` 确认协议
  - `extractConfirmationFromEvent` 从 Matrix 事件提取确认请求；`ingestHitlTimelineEvents` 按时间排序摄入，处理 m.replace 修订（保留确认则 upsert，移除确认则 dropByEventId）
  - 全局 sync 集成：`use-global-matrix-sync.ts` 的 `ingestWorkflowEvents` 旁增加 `ingestHitlTimelineEvents` 调用，历史加载（最近 10 房间 × 30 条）和实时 sync 都摄入
  - 深链模式：store 暴露 `takePendingChatRoomId` / `takePendingProjectKey` 原子消费方法，组件在渲染期调用避免 effect 里 setState 触发 lint 错误
  - 总览 UI：`src/components/dashboard/sections/hitl-inbox-card.tsx` 显示待审批工具 + 暂停项目，点击跳转对应 section
  - 单测覆盖：`hitl-inbox.test.ts`（9 个测试）+ `use-global-matrix-sync.test.tsx` 新增确认采集测试（共 17 个测试通过）
  - eslint 规则 `react-hooks/set-state-in-effect` 禁止在 effect 里同步 setState，采用渲染期原子消费模式绕过
  - typecheck 用 `./node_modules/.bin/tsc --noEmit`，vitest 用 `./node_modules/.bin/vitest run`，eslint 仅跑改动文件

[Project Knowledge Summary]
- Date: 2026-09-07
- Context: 闭环 Dashboard 侧栏 + composer 活动轨道 + Worker 一键进聊天 + 审计 L2 自审权限
- Category: Workflow & Collaboration | Environment Configuration
- Instructions:
  - `GET /api/agentteams/audit` 现已支持 L2+ 访问：L2 走 `scope: 'self'`（仅看自己 actor 的事件，server 端强制 `query.actor = identity.name`，客户端伪造参数无法绕过）；L3+ 走 `scope: 'all'` 全公司视角。L1/无身份仍 403。**注意**：上方 2026-09-03 旧条"audit admin-only"已过期
  - 403 响应体新增 `observedLevel` / `requiredLevel`，前端 `useAuditEvents` 透传；`audit-section.tsx` 区分两种失败文案：身份头缺失（dev/AGENTTEAMS_AUTH_DISABLED）vs 等级不足
  - 侧栏房间按 `groupRoomsByType` 分组（team/agent/manager/human/unknown），每行渲染 `lastMessagePreview || parentTeam || id` 兜底，`extractMessagePreview` 已知处理 m.text / m.image / m.file / m.audio / m.video / 非 m.room.message / 空 body
  - 跨区聊天跳转统一走 `src/lib/open-chat-room.ts:openChatRoom(roomId)`，空 roomId 静默忽略。`workers-section` / `hitl-inbox-card` / `tasks-section` 都用这个入口
  - composer 上方 `AgentActivityTrack` 展示任务进度 + HITL 待办
  - 守卫写法：渲染可选字段时禁止用 `value || value` 这种"value 可能是 undefined"的回退（会渲染字符串"undefined"），用 `value ? <Badge>...</Badge> : null` 替代
  - 本次 commit 风格：1 个 feat commit + 1 个 fix commit 紧跟其后，fix 不 amend 进 feat 保持历史清晰
  - `git push` 由用户口头确认后执行，未授权不主动 push

[Project Knowledge Summary]
- Date: 2026-09-20
- Context: 批量检查并合并 fork PR（#129/#127/#128），解冲突后 force push fork 分支完成合并
- Category: Workflow & Collaboration | Troubleshooting & Debugging
- Instructions:
  - gh CLI 无登录态：用 `git credential fill`（credential.helper=/app/agent/bin/agent）取 token 设 GH_TOKEN，token 值不得出现在回复/日志
  - GitHub merge API 遇 502/504 后会进入 "Merge already in progress" 锁：等 30-60s 重试 REST PUT /pulls/{n}/merge 即成功，不要反复立即重试
  - fork PR 冲突解法：PR 上 maintainer_can_modify=true 时，本地基于最新 main 重建解冲突提交，`git push --force-with-lease=refs/heads/<branch>:<旧tip-sha> fork-url merge-x:<branch>`，等 CI 绿再合
  - 解冲突禁止直接 `git checkout pr-xx -- 共享文件`：PR 基点落后时会把 main 上后来的修复（如 a11y-axe 的 role="img"、主题 token）一起回退，CI 挂 aria-prohibited-attr；共享组件用 main 版本 + 手工叠加 PR 改动
  - 合并顺序按文件重叠排：无重叠先合，同文件 PR 逐个叠加 rebase（本次 #129 独立 → #127 → #128 都动 ChatRoom/MessageBubble）
  - 分支门验证顺序沿用：tsc --noEmit → eslint（仅改动文件）→ vitest run（目标文件），全绿才推

[Project Knowledge Summary]
- Date: 2026-09-20
- Context: 合并 3 个 CHANGES_REQUESTED PR（#106/#109/#125），用户授权「直接合并并修复」——替作者落实评审意见后合入
- Category: Workflow & Collaboration
- Instructions:
  - 评审修复合入流程：`gh api repos/{org}/{repo}/pulls/{n}/reviews` 读评审正文、`.../comments` 读行内意见；逐条落实修复 → 本地 merge 最新 main 出合并提交 → force-with-lease 推 fork 分支 → CI 绿 → REST PUT squash 合入；同时 `gh pr edit` 修正 PR 正文失实描述
  - 文本级 auto-merge 成功 ≠ 语义合并成功：双方都改过的热点文件必须逐个 diff 两侧行为；add/add 重复实现冲突取 main 超集版本；大文件冲突取 PR 版本为基底再手工补回 main 侧硬化（如 401 文案、HTML 容错）
  - 评审要求「拆 follow-up」的部件（如 #125 的 3D 图谱）：从 PR 剥离后原代码仍保留在本地 pr-xx 分支 git 对象中，后续重建 follow-up PR 时从该分支取件 rebase
  - 功能开关 env（如 AGENTTEAMS_APPROVAL_DOCKER_PLANE）默认关，测试 beforeEach stub 空串、Docker 场景单测内显式开

[Project Knowledge Summary]
- Date: 2026-09-20
- Context: 知识库 workspace-files 502/HTML 报错联合排查，用户在 Controller 侧实测后修正 Agent 最初的网关路由假设
- Category: Troubleshooting & Debugging | Operations & Deployment
- Instructions:
  - embedded 模式下 Controller 直连 worker 容器 `http://agentteams-worker-<name>:<console port>`（实测 8088），全程无 Higress 参与；排查 worker 级 API 时别往网关路由方向查
  - QwenPaw worker 的 workspace API 带 `/api` 前缀（`/api/workspace/tree` 200 JSON）；裸 `/workspace/*` 会命中 worker SPA 兜底返回 200 text/html——路径少 `/api` 是 Controller `worker_workspace_files.go` 的确定性 bug（`worker_checkpoints.go` 同病），对齐 `worker_runtime_config.go` 的 `/api/` 写法即修
  - Controller 200 分支无条件覆盖 Content-Type 为 application/json（worker 返回的 CT 是诚实的 text/html）→ 上游 header 不可信，dashboard 只能嗅 body（proxy-helper 已落地 HTML 嗅探改写 502）
  - worker 级 API 报 502 "worker workspace API unreachable" = 容器 DNS/连接失败：容器不存在、镜像拉取失败（如 qwenpaw-worker:latest pull 失败）、或凭据缺失（如 Message: refresh credentials: credentials not found for <name>）——用 ContainerState/Message 区分
  - 不存在的 worker 名走同一 502 路径；存在但容器坏的 502 与 SPA 兜底的 200 HTML 是两类故障，先分清再查

[Project Knowledge Summary]
- Date: 2026-09-30
- Context: 热更新功能落地（应用内热补丁方案）后，用户要求把发布配合固化为发版规范
- Category: Operations & Deployment
- Instructions:
  - 发版规范 canonical 文档：docs/RELEASE.md（版本三方一致、常规发版序列、热补丁通道、坑清单），本条目只存要点索引
  - 发版序列：bump package.json → tag vX.Y.Z（build.yml 自动出镜像）→ gh release create → npm run build && sh scripts/build-hotfix-bundle.sh vX.Y.Z → gh release upload 两个资产 → 服务器 pull + up -d
  - 热更新 = 应用内补丁（L1 触发，下载 release 热更新包 → sha256 校验 → 热替换 appDir 旧版留 app.prev → process.exit 由容器监管方拉起），无 docker socket / 无旁路容器；docker 与 k8s 行为一致
  - k8s 约束：需可写根文件系统；多副本以镜像滚动更新为准，热补丁是单实例快速通道，Pod 重建后补丁丢失是预期语义
  - 服务器需可达 api.github.com + github.com（热更新依赖）；仅影响热更新与上游提示，构建号追平（/api/dashboard-build）不受影响
  - 版本三方一致是硬约定：tag = package.json = 构建代码；漏 bump 会导致检查更新误报上游新版本；release 用三段版本号（compareSemver 只比三段）

[Project Knowledge Summary]
- Date: 2026-09-30
- Context: Discovered by Agent while releasing v1.2.5-beta.5 with deterministic build-id fix
- Category: Build & Compilation / Troubleshooting & Debugging
- Instructions:
  - 三门 gates 的 tsc 覆盖 next.config.ts（tsconfig include 含 **/*.ts），改配置文件后必须跑 tsc：本次 gates 只跑 eslint+vitest 漏掉 next.config.ts 的重复 import（readFileSync 双导入），只有 next build 的 TypeScript 检查拦下，导致一次构建返工、tag 被迫 git tag -f + gh release 重打
  - gh release upload 32MB 补丁包在前台 bash 会超时（慢上行），须用 background_terminal_create；GH_TOKEN 需在 workspace 目录取（gh 依赖 git credential）
  - hotfix bundle 已知现象：.next/standalone 根会被 Turbopack 整项目 tracing 污染（server-package.ts 动态 process.cwd() 路径触发），bundle ~32M 含 workspace 杂文件（coverage/logs/dev.log 等）；布局与容器 appDir 兼容、applyHotfix 校验不受影响，beta.2-beta.5 均如此，无需处理
  - 构建号一致性验证法：cat .next/BUILD_ID 与 grep -rhoE "git-[0-9a-f]{7,10}" .next/static/chunks .next/server | sort -u 必须单一值；客户端 1 处内联 + 服务端约 19 处引用

[Project Knowledge Summary]
- Date: 2026-10-14
- Context: 新建独立项目 3end-bot（三端 bot）时，用户要求与外仓代码零相关、独立仓库
- Category: Operations & Deployment | Build Methods | Workflow & Collaboration
- Instructions:
  - 参考项目 `github.com/QingJ01/DS-Bot` 本人仓库不存在；实际是 `QingJ01/DS-Bot-App`（fork 自 `Fei2411/DeepSeek-Bot`，插件包名 `ds-bot`，运行在 DeepSeek Harness 上）。可行性评估落在本仓 `docs/at-bot-feasibility-assessment.md`
  - 三端 bot 位于 `/workspace/3end-bot`，是独立 git 仓库（已 `git init`，分支 main）；外层 `/workspace/.gitignore` 已加 `/3end-bot/` 隔离，主仓不追踪它
  - 技术栈 npm workspaces + TS 单仓库：`packages/core`（团队/@解析/群聊回合/记忆/LLM）、`packages/server`（原生 node:http，无 web 框架）、`packages/web`（Vite+React）；`packages/desktop`（Electron）与 `packages/mobile`（Expo）刻意不进 workspace，需各自 `npm install`（重型依赖）
  - 运行：`cd /workspace/3end-bot && npm install && npm run build`（web→packages/web/dist）`&& npm start`（服务端 :8787 同时托管 API 与 web）；开发用 `npm run dev`（server + Vite HMR）
  - 模型走 OpenAI 兼容 `/chat/completions`，用户自备 key 写 `.env` 的 `USER_LLM_BASE_URL/API_KEY/MODEL`；无 key 时服务端回退 mock 回复，全链路仍可演示。数据落 `data/state.json` + `data/memory/*.md`，`DATA_DIR` 可覆盖
  - 验证：`npm run typecheck`（tsconfig.base 需 `allowImportingTsExtensions: true`）；群聊默认主管回答，`@Name` 定向，`[PASS]` 静默

[Project Knowledge Summary]
- Date: 2026-10-15
- Context: Discovered by Agent while fixing #138 license and #139 installer drift
- Category: Workflow & Collaboration | Testing Methods
- Instructions:
  - `install/agentteams-install.sh` 是 `agentscope-ai/AgentTeams` 上游安装器的工作副本，额外含待上游化的 Higress external adapter 改动（`AGENTTEAMS_HIGRESS_ADAPTER_MODE` / `AGENTTEAMS_AI_GATEWAY_URL` / `AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS` 及 `DASHBOARD_CONFIG_FILE` 数据卷路径）。上游漂移由 `.github/workflows/upstream-drift.yml` 每周一开 issue 告警，阈值 50 行或 diff 命中 "dashboard"
  - 对齐方法（3-way rebase）：本仓副本基于上游 `82cbd5f`（#1075 引入 dashboard 集成），该 commit → 本仓副本的差异即"待上游改动集"；用 base/local/upstream 三分支 `git rebase` 将其重放到 upstream main，冲突保留上游新结构（`_ctrl_env_prefix`、QwenPaw/DeepSeek 镜像、`DASHBOARD_SESSION_SECRET` 持久化）再叠加 adapter。残余 diff 约 90 行，adapter 未上游化前每周仍会触发告警
  - 安装器验证命令（无需 Docker）：`bash -n install/agentteams-install.sh`、`bash scripts/check-docs-consistency.sh`、`bash install/agentteams-dashboard-tests.sh`（60 用例）
  - 本仓根目录原本缺 `LICENSE`；许可证采用 Apache-2.0（Copyright 2026 AgentTeams Contributors，与上游一致），`package.json` 亦补 `license` 字段

[Project Knowledge Summary]
- Date: 2026-10-18
- Context: Workbench 重构（PRD v1.1）M1 骨架实施，分支 261018-feat-workbench-refactor-m1
- Category: Workflow & Collaboration | Build Methods | Environment Configuration
- Instructions:
  - Workbench 重构 PRD 归档在 .monkeycode/specs/workbench-refactor/prd.md（v1.1 终稿，14 周 4 里程碑）
  - M1 骨架已全部落地（分支 261018-feat-workbench-refactor-m1）：混合 IA、分层 hash、经典导航开关、孤儿清理、版本统一、命令面板扩展、F1.1 空间切片、F1.2 接力卡（依赖/责任/摘要/展开/跳转）、F1.3 工件三态（任务维度，released 带 M1 降级说明）、F1.5 切片（@name 直达会话）、F4.1 切片（roomId 直达空间）
  - F1.3 注意：消息流工件卡与 pending_review 态的事实源（放行记录 com.agentteams.release / 审查请求块）待 M2 F2/F3 落地，M1 只在任务详情与接力卡展开区呈现三态
  - M2 进度：F2.1 干预卡（v2 协议消费侧 + 全交互规格 + 消息回写降级徽标）、F2.2 超时置灰与升级通知（审计 hitl.expire 待 BFF 落点）、F2.3 收件箱互通已完成；F2.4 回写审计、F3 审查闭环（F3.1-F3.4）未开始
  - 干预协议约定：isInterventionConfirmation 按 question/options/questions 字段存在判定，v1 工具确认不受影响；答案回写上游 v2 answer 契约就绪前一律走「自然语言消息发回房间」降级，UI 徽标常显
  - F3 审查闭环已落地：review.report v2 块（协议/parser/报告卡）、放行记录走 com.agentteams.release 房间状态事件（新 BFF state-event 仅放行 com.agentteams.* 前缀，session 归因 + release.* 审计）、自动放行走 com.agentteams.space 事件（默认关）；放行记录独立 stateKey 写入历史不覆盖；artifact-state 放行历史优先于任务状态推导
  - M2 全部落地：F2.4 hitl.* 审计经 POST /api/agentteams/hitl/audit（白名单校验 + session 归因）；F5.1 拓扑强化（assignee/条件边/关键路径 criticalPathOf/卡住节点点击直达会话）。M2 出口「旅程 B/D 端到端」待上游联调
  - M3 全部落地（F8.3 示例空间/循环除外——依赖演示运行时）。M4 进度：F4.2 我的工作台（第 15 项导航 my-workbench，聚合干预/审批/@我）、F4.3 PendingBanner 顶栏待办横幅、F8.2 三步引导（welcome-steps，localStorage 跳过）、侧栏控制台区角色自适应折叠（userLevel<3 默认收起）已落地
  - M4 进度：F4.2/F4.3 横幅/引导/角色折叠 + F7.1 资源收敛（ResourcesSection 容器 + mergedInto 机制：Workbench 侧栏隐藏旧项，经典导航/sectionMap/旧深链保留，功能零删减）已落地
  - 重构整体状态：PRD P0 全部交付，P1 除 F4.3 SSE 化（P2 口径）与 F8.3 示例空间（依赖演示运行时）外全部落地。残余事项：F7.1 的「Agent 目录产品化」增强（头像/技能标签/加到空间——现有 workers-section 已有卡片基础）、性能验收（Lighthouse CI）、v2.0 灰度发版（docs/RELEASE.md 流程）
  - 分层 hash 唯一映射层是 src/lib/nav-hash.ts：section id 保持扁平，hashForSection 对无映射 id 回退原值（plugin-route 即走此路径）；旧扁平 hash 经 history.replaceState 归一化，带 roomId/params 的分层 hash 不归一化
  - 导航数据源：nav-items.ts 的 NavItem 带 area('workbench'|'console') + group + legacyGroup（经典导航开关用，store persist v4）；侧栏分组统一走 use-nav-sections.ts
  - 本环境 npm ci 报 usage error 不可用，装依赖用 npm install --no-audit --no-fund（约 2 分钟）
  - 全量 vitest 基线：244 文件 / 2281 测试（孤儿清理后），全量跑约 3.5-4 分钟；孤儿 section（architecture/security/quickstart/runtime/docs/projects 共 7 文件）已于 M1 删除
