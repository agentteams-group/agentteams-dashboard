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
  - 写操作路由的 RBAC 现在服务端强制：workers/teams/managers/humans 的 POST/PUT/DELETE/wake/sleep/ensure-ready 调用 `enforceServerSideRbac`（src/lib/server-auth.ts），403 写 warning 审计。skills/storage/projects/gateway/mcps/models-probe 等路由**未**接入，下一个 PR 推进
  - middleware 在 Higress session 验证通过后注入 `x-agentteams-user` / `x-agentteams-user-level`，proxy-helper 透传给 Controller。修改相关代码时记得：identity 头来自 middleware 不是浏览器，不要直接 `request.headers.get('authorization')` 当成 user 头
  - `recordToolCalls(workerName, eventId, blockCount, now?, structuredKeys?)` 第 5 个参数 `structuredKeys` 是 v1 协议（`org.agentteams.run`）结构化 tool_call 的 id 列表。传入时跳过 event-delta 计数，仅按 id 去重。纯 v0/无结构化数据时维持原 eventId 增量语义
  - `usePersistedDraft(roomId)` 暴露 `setValueLocal`（不写 storage）专供 edit session 回填——直接用 `setValue` 会把编辑中的内容持久化，下次进房间会看到。ChatRoom.tsx 的 handleRequestEditLast / handleCancelEdit 都用 setValueLocal
  - feature-implementer skill 要求每个 task 完成后停下来等用户确认，不要自动推进下一 task。本次按此规范逐项推进 P0-1 / P0-2 / P1-4 Phase1，每项独立 commit + 验证
  - PR 风格沿用项目约定：标题 `type(scope): summary`，正文包含验证证据（vitest 数字）、兼容性声明、风险与关注点
