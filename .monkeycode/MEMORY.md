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

[Project Knowledge Summary]
- Date: 2026-08-21
- Context: 修改 Beta 设置与 Overview 运行信息面板时执行构建验证
- Category: Build Methods | Testing Methods
- Instructions:
  - typecheck 必须用 ./node_modules/.bin/tsc --noEmit 或 npm run typecheck；直接 npx tsc 会误装废弃的 tsc@2.0.4 包报错
  - vitest 4 已移除 --reporter=basic，直接运行 ./node_modules/.bin/vitest run 或 npm test
  - 验证顺序：typecheck -> eslint（仅改动的文件）-> vitest run（全量 129 文件约 3 分钟）

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
