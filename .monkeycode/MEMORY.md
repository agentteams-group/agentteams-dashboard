# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry

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
- Date: 2026-08-07
- Context: Issue-native change management
- Instructions:
  - Use the issue-spec coordinator workflow for proposal, design, implementation, independent review, verification, durable projection, and closure work.
  - Run issue-spec authentication and workflow validation before routing issue-native work.
  - Agent-executed change-bearing PROCESS nodes use managed workspaces, a real non-Coordinator worker, and an independent reviewer for every active SPEC.
  - For final issue-spec verification, forecast the final gate, resolve validator blockers, and run both compact and full authoritative verification before merge.

[Project Knowledge Summary]
- Date: 2026-08-03
- Context: Agent implemented Skill Center feature (skill-center) with issue-spec workflow
- Category: Build Methods
- Instructions:
  - New API routes: GET/POST /api/agentteams/skills, GET/PUT/DELETE /api/agentteams/skills/[name], GET/PUT /api/agentteams/skills/nacos/config, POST /api/agentteams/skills/nacos/sync
  - New hooks: src/hooks/use-skill-center.ts (useSkills, useSkill, useCreateSkill, useUpdateSkill, useDeleteSkill), src/hooks/use-nacos-config.ts (useNacosConfig, useUpdateNacosConfig, useNacosSync)
  - New components: src/components/dashboard/sections/skills/skill-center.tsx, skill-upload-dialog.tsx, nacos-config-dialog.tsx, skill-selector.tsx
  - SkillCenter replaces skills-section.tsx's dynamic skill view; Worker skill selection now uses SkillSelector component instead of comma-separated input
  - Skills stored in MinIO `skills` bucket with metadata at `skills/{name}.json`
  - Nacos config persisted to `.skill-center-config.json` in project root
  - TypeScript namespace should NOT be used in server-side config modules (causes @typescript-eslint/no-namespace error)
  - createSkill API returns 409 on conflict with `{ success: false, conflict: true, existing: SkillEntry }`; client handles via response status, not return value
  - PR #33 created: https://github.com/agentteams-group/agentteams-dashboard/pull/33

[Project Knowledge Summary]
- Date: 2026-08-03
- Context: Agent fixed skill upload 502 error caused by Uint8Array type mismatch
- Category: Troubleshooting & Debugging
- Instructions:
  - MinIO SDK `putObject` third argument requires `stream.Readable | Buffer | string`, NOT `Uint8Array`
  - `parseSkillPackage` returns file data as `Uint8Array` in `f.data`
  - Fix: always wrap with `Buffer.from(f.data)` before passing to `putObject`
  - Affected routes: `src/app/api/agentteams/packages/route.ts` and `src/app/api/agentteams/workers/[name]/skills/route.ts`
  - PR #28: https://github.com/agentteams-group/agentteams-dashboard/pull/28

[Project Knowledge Summary]
- Date: 2026-08-03
- Context: Agent implemented MCP server CRUD feature for skills management section
- Category: Build Methods
- Instructions:
  - MCP servers are now managed via dedicated API routes: GET/POST /api/agentteams/mcps and GET/PUT/DELETE /api/agentteams/mcps/[name]
  - MCP data is persisted to MinIO under mcp-servers/{name}.json
  - New hooks: useMcpServers, useMcpServer, useCreateMcpServer, useUpdateMcpServer, useDeleteMcpServer
  - New component: src/components/dashboard/sections/mcps/mcp-server-dialog.tsx (uses react-hook-form)
  - SkillsSection now integrates MCP management with add/edit/delete buttons
  - react-hook-form is now a dependency (added in this session)
  - Label: MCP server name must match /^[A-Za-z0-9][A-Za-z0-9._-]*$/
  - transport values are 'sse' or 'streaminghttp'
  - PR #27 created: https://github.com/agentteams-group/agentteams-dashboard/pull/27

[Project Knowledge Summary]
- Date: 2026-08-09
- Context: Updated during PR #78 debug-log review validation
- Category: Environment Configuration
- Instructions:
  - Dependencies are installed via `npm ci --no-audit --no-fund` (lockfile is current); after that `npm run typecheck` / `npm run lint` / `npm test` resolve their executables.

[Project Knowledge Summary]
- Date: 2026-08-01
- Context: Agent implemented Matrix chat UI restructure with virtualized message list
- Category: Build Methods
- Instructions:
  - New components created: structures/MessageList.tsx, structures/ScrollPanel.tsx, views/MessageBubble.tsx, views/EventTile/index.tsx, grouper/MainGrouper.ts, ChatRoom.tsx, ChatPanel.tsx, ChatSection.tsx, ChatStore.tsx, components/MessageInput.tsx
  - Added `react-virtuoso` to package.json dependencies for virtualized scrolling
  - Extended DisplayMessage interface with threadId, replyCount, isEdited fields
  - All new code passes TypeScript and ESLint checks
  - Test suite: 259 tests pass
  - Build: `npm run build` compiles successfully
  - Source files are in `/workspace/src/components/dashboard/sections/chat/`, NOT in `/workspace/packages/dashboard/src/`
  - ScrollPanel uses Virtuoso with `followOutput: 'auto'` for auto-scroll and `scrollTo({ top: MAX_SAFE_INTEGER })` for manual scroll-to-bottom
  - MessageList uses forwardRef to pass Virtuoso ref for imperative scrolling from ChatRoom

[Project Knowledge Summary]
- Date: 2026-08-01
- Context: Discovered by Agent while fixing Matrix chat ordering/typing/avatar bugs after element-web refactor
- Category: Troubleshooting & Debugging
- Instructions:
  - Chat message timeline must stay chronological (older on top, latest at bottom). `formatMatrixEvents` in src/hooks/use-matrix.ts is the single place that sorts events; Virtuoso in ScrollPanel.tsx renders items top-down with `followOutput: 'auto'` + `firstItemIndex` offset to anchor the viewport when older pages are prepended.
  - "Load earlier messages" UI lives in MessageList header (top), never in the footer; the footer is reserved for latest messages.
  - Typing indicator pipeline: ChatRoom uses `useTypingNotification` (throttle 4s, idle-stop 4s, stop on send/unmount) for outgoing, and `useTypingSync` (long-poll /sync) for incoming. `matrix-store.syncGeneration` is bumped on logout to kill in-flight sync loops with stale tokens.
  - `atBottomStateChange` from react-virtuoso drives both the autoScroll flag and the "N 条新消息" jump-to-latest badge in ChatRoom; do not duplicate scroll-position math elsewhere.
  - Removed dead components: chat/message-bubble.tsx (legacy) and chat/components/MessageInput.tsx (legacy); active ones are views/MessageBubble.tsx and chat-composer.tsx.

[Project Knowledge Summary]
- Date: 2026-08-02
- Context: Discovered by Agent while fixing Higress route alias binding "不可用" misreport for sensenova-6.7-flash-lite
- Category: Troubleshooting & Debugging
- Instructions:
  - Higress ai-proxy / model-mapper semantics: `modelMapping` with an empty-string target `""` means "keep the original request model name" (passthrough); a route/upstream that declares no mapping at all also forwards the request model name unchanged and is callable. Only a *configured* mapping with no matching key (exact, `gpt-3-*` prefix, or `*` fallback) makes the request fail. When checking a model binding's availability, passthrough must count as available with `targetModel` equal to the alias.
  - `rawConfigs.modelMapping` on a Higress provider is untyped in the Console response, so values must be type-guarded to strings before use.
  - When a route upstream declares its own `modelMapping`, it fully overrides the provider-level `rawConfigs.modelMapping` (ai-proxy route config wins); it does not fall back to the provider mapping when a key is missing.

[Project Knowledge Summary]
- Date: 2026-08-03
- Context: 发现 Worker 容器无法读取 Dashboard 分发的技能包
- Category: Troubleshooting & Debugging
- Instructions:
  - Worker 容器启动时缺少 AGENTTEAMS_FS_BUCKET 环境变量
  - Dashboard 上传技能包到 MinIO 的 agentteams-storage bucket，路径为 agents/{workerName}/skills/{skillName}/
  - Worker 容器只有 FS_ENDPOINT/ACCESS_KEY/SECRET_KEY，没有配置 FS_BUCKET
  - 修复方案：在 worker 启动脚本中添加工具变量 AGENTTEAMS_FS_BUCKET=${AGENTTEAMS_FS_BUCKET:-agentteams-storage}
  - 受影响的 Worker 需要重新创建才能生效
  - PR: 待创建

[Project Knowledge Summary]
- Date: 2026-08-03
- Context: Agent fixed P1 (Nacos skills not persisted) and P2 (cross-source name uniqueness) review findings in skill center
- Category: Troubleshooting & Debugging
- Instructions:
  - syncNacosSkills() in src/lib/skill-center-storage.ts persists Nacos skill metadata to MinIO skills bucket (source='nacos')
  - Custom skills take precedence: if a custom skill exists with same name, Nacos sync skips it and updates updatedAt only
  - GET /api/agentteams/skills returns all skills from MinIO (no need for separate Nacos query at request time)
  - POST /api/agentteams/skills checks name uniqueness across ALL sources (custom + nacos), returns 409 with existing entry
  - The shared storage module skill-center-storage.ts should be used by both route.ts and sync/route.ts to avoid duplication


[Project Knowledge Summary]
- Date: 2026-08-04
- Context: Agent completed code quality optimization workflow via issue-spec (issues #34-36, PR #37)
- Category: Workflow & Collaboration
- Instructions:
  - issue-spec workflow: Proposal #34 → Design #36 → Implement #35, with comments tracking task completion
  - Phase 1 (zombie code): remove orphaned files + unused exports + dead GET handlers, then fix notification logic references
  - Phase 2 (deduplication): extract shared helpers into a dedicated file (e.g. src/app/api/higress/helpers.ts)
  - Phase 3 (deps): only remove deps with zero direct imports; verify transitive deps are safe to keep
  - Phase 4 (bugs): verify type-checker behavior before changing const/let; ESLint prefer-const is a reliable guide
  - models-section.test.tsx has a flaky timeout under full suite run (passes in isolation); use --retry=2 for CI

[Project Knowledge Summary]
- Date: 2026-08-05
- Context: Agent added tests for SkillUploadDialog and investigated upload button disabled issue
- Category: Testing Methods
- Instructions:
  - SkillUploadDialog button disabled logic: `isReady = !!file && !!preview && !createMutation.isPending`, button disabled when `!isReady || createMutation.isPending`
  - handleClose resets file/preview state but does NOT call createMutation.reset() - mutation state persists across dialog reopen
  - Test mock pattern: use static vi.mock at module level for hooks and skill-package; avoid vi.doMock with await in beforeEach
  - File input has no label text; use document.querySelector('input[type="file"]') instead of screen.getByLabelText
  - 368 tests pass across 46 test files; typecheck clean

[Project Knowledge Summary]
- Date: 2026-08-09
- Context: Discovered by Agent while validating PR #78 debug-log changes; fixed same day
- Category: Troubleshooting & Debugging
- Instructions:
  - Fixed pre-existing failures in `src/app/api/agentteams/workers/[name]/files/route.test.ts`: (1) it passed `new Request(...)` but the handler reads `request.nextUrl.searchParams`, so the typecheck failed (`Request` not assignable to `NextRequest`) and vitest threw `Cannot read properties of undefined (reading 'searchParams')`; fix = import `NextRequest` from 'next/server' and construct `new NextRequest('http://localhost')`. (2) `createObjectStream` used `queueMicrotask`, which fires BEFORE the handler registers 'data'/'end' listeners (handler waits on its `await params` continuation, which runs after the microtask queue), so events were lost and tests hung until timeout; fix = use `setImmediate` (fires after all microtasks). (3) assertions were stale: handler returns `prefix: ''` and strips `agents/` via `stripAgentsPrefix`; updated expected objects accordingly.
  - debug-log validation status: homeserver-allowlist (15), redact (20), route (6) tests all pass; lint clean; typecheck clean for the 9 debug-log files.

[Project Knowledge Summary]
- Date: 2026-08-09
- Context: Discovered by Agent while updating v1.2.2 tag to current main and syncing docs with code
- Category: Testing Methods
- Instructions:
  - Full test suite is `npm test -- --reporter=dot` via vitest; current baseline is 445/445 passing across 58 test files (~88s runtime). `npm run typecheck` reports 0 errors (the historical `workers/[name]/files/route.test.ts` failures are fixed).
  - `v1.2.2` tag was force-moved from 9097262 to the current main HEAD (4b5f0f3) after the debug-log + worker-files merge; the Dashboard installers default to `v1.2.2` (install/agentteams-install.sh, install/agentteams-dashboard.sh, install/agentteams-dashboard.ps1).

[Project Knowledge Summary]
- Date: 2026-08-11
- Context: 完成 chat-unread-sort-rendering 功能 M1（全局单例同步 + 稳定排序）后更新
- Category: Testing Methods
- Instructions:
  - 全量测试基线为 548/548（66 个测试文件，vitest），`npm run typecheck` 0 错误，`npm run lint` 中 workers-section、use-task-board、nacos-sync-engine、skill-package、task-store 存在既有 lint 错误（非聊天模块引入）。
  - Matrix `/sync` 循环现在只有一处：`useGlobalMatrixSync`（src/hooks/use-global-matrix-sync.ts），挂载于 dashboard 级，登录期间常驻；syncToken 跨房间切换保留。新增 Matrix 实时能力时应扩展该 hook 的分发，而不是新建第二个 /sync 循环。
  - 聊天会话列表排序以时间为主（`sortRoomsByRecency`），未读/@提醒状态只作角标样式，不参与排序键；清除未读不会改变房间在列表中的位置。
  - `useRoomMetaStore.activeRoomId` 记录当前打开的房间，全局同步循环仅对该房间执行 `mergeTimelineEvents` 写消息缓存。
  - `matrixApi.sync` 已支持第 5 个参数 `filter`（sync filter JSON 字符串），透传至 `/api/matrix/sync?filter=`。

[Project Knowledge Summary]
- Date: 2026-08-11
- Context: 完成 chat-unread-sort-rendering 功能 M2（已读双写与阅读位置恢复）后更新
- Category: Build Methods
- Instructions:
  - 全量测试基线更新为 565/565（69 个测试文件，vitest），`npm run typecheck` 0 错误；lint 中 tasks-section、agent-teams-dashboard、mobile-sidebar、use-task-board 等存在既有错误（非 M2 文件引入）。
  - `m.read` 回执通过新代理路由 `POST /api/matrix/rooms/{roomId}/receipt`（body `{eventId}`）转发到 `/_matrix/client/v3/rooms/{roomId}/receipt/m.read/{eventId}`，该接口要求空 body、事件 id 放在 URL 路径里。
  - `markAllRead` 双写顺序：先 `m.read`（`matrixApi.sendReadReceipt`，best-effort，失败仅 console.warn）再 `m.fully_read`（read-marker 路由）；`markAllRead(targetOverride?)` 支持指定事件 id，发送成功时推进到已发送事件。
  - read 位置推进收敛为三个触发点：`handleAtBottomChange(true)`（滚到底）、发送成功、`handleJumpToNew`；新消息 watcher 不再冗余调用 `markAllRead`，进入房间不推进阅读位置。
  - ScrollPanel 初始 mount 存在 `kind==='read-marker'` 项时 `scrollToIndex({ index: markerIndex, align: 'start' })` 并置 `atBottomRef.current=false`（避免触发 `onAtBottomChange(true)`）；`scrollToItem(key)` 按 divider key/message id/eventId 定位并 `highlightIndex`。
  - ChatRoom 组件测试 mock 要点：`react-virtuoso` 用 forwardRef mock 捕获 props 并暴露 `scrollToIndex`；`@/hooks/use-matrix` 用 `importOriginal` 部分覆盖（保留 `useMatrixStore` 需从 `@/lib/matrix-store` 单独导入）；`ReadReceiptEntry` 类型为 `{ eventId, ts }`，不含 roomId。

[Project Knowledge Summary]
- Date: 2026-08-11
- Context: 完成 chat-unread-sort-rendering 功能 M3（归一化渲染管线与流式中间态）后更新
- Category: Build Methods
- Instructions:
  - 全量测试基线更新为 585/585（70 个测试文件，vitest），`npm run typecheck` 0 错误；lint 中 tasks-section、agent-teams-dashboard、mobile-sidebar、use-task-board 等存在既有错误（非 M3 文件引入）。
  - 消息归一化唯一入口为 `normalizeToBlocks`（src/lib/a2ui/normalize.ts），9 条优先级命中即返回：agentteams.workflow → org.agentteams.run → A2UI 标记 → Tool Guard 确认文本 → agentscope repr → `Thinking:` 前缀 → com.agentteams.long_message(M4) → legacy card/details → text 兜底。新增代码走该入口，不要直接调 parser 子步骤。
  - `DisplayMessage` 新增 `rawContent`（合并 m.replace 后的原始 event.content），MessageBubble 靠它喂给 normalize；`workflow`/`agentBlocks` 字段仍保留供其它消费者。
  - `parseA2uiMarkers` 已从 `parseA2uiContent` 提取为独立导出子步骤（返回 blocks 或 null）；`parseEmbeddedAgentReprBlocks` 已导出；死代码 `legacyToA2uiMessages`/`thinkingToA2uiMessages` 已从 parser.ts 与 index.ts 删除。
  - `MarkdownMessage` 增加 `isStreaming` prop：流式且正文无块级特征（代码 fence/标题/引用/列表/表格/`$$`）时走 `<pre class="whitespace-pre-wrap">` + 流式光标，否则完整 ReactMarkdown。`parseCustomBlocks` 已删，card/thinking 由归一化层在块级别剥离。
  - jsdom 下 rehype-highlight 会把代码行渲染成 `[object Object]`，代码块测试断言用 `container.querySelector('pre code')` 存在性，不要断言文本内容。

[Project Knowledge Summary]
- Date: 2026-08-11
- Context: 完成 chat-unread-sort-rendering 功能 M4（A2UI 流式容错与长消息附件）后更新
- Category: Build Methods
- Instructions:
  - 全量测试基线更新为 603/603（72 个测试文件，vitest），`npm run typecheck` 0 错误；lint 中 tasks-section、agent-teams-dashboard、mobile-sidebar、use-task-board 等存在既有错误（非 M4 文件引入）。
  - 依赖升级：`@a2ui/web_core` 0.10.3→0.10.6、`@a2ui/react` 0.10.1→0.10.2。`@a2ui/web_core@0.10.6` 的 MessageProcessor 会对 catalog schema 校验组件 props 并抛异常，A2uiMessage 必须在 useMemo 内 try/catch 任意异常类型（该新校验读 zod v3 的 `error.errors`，但本项目 catalog 桥接 zod v4 只有 `error.issues`，schema 不匹配时异常类型不定，`catch` 里不能依赖具体字段），失败渲染「交互消息解析失败」+ 原始 JSON。兜底不能用 useEffect/state 注册，否则 throw 发生在渲染前无法触发 state。
  - 流式容错：`parseA2uiMarkers(body, formattedBody, isStreaming)` 检测未闭合标记（``` ```a2ui ``` fence 后无闭合 ``` 、`<!--a2ui:` 后无 `-->`），isStreaming 时返回 `[{ type:'a2ui', isStreaming:true }]`，MessageBubble 渲染 Loader2 加载占位卡，避免半成品 JSON 在流式帧间闪烁；完整标记 JSON 解析失败仍降级文本。
  - 长消息附件：`com.agentteams.long_message`（version/url/filename/mimetype）→ `AttachmentCard`（attachment-card.tsx），AttachmentPayload 为 `{ url: string; filename: string; mimetype: string }`，`ParsedA2uiBlock['type']` 扩展 `'attachment'` 并加入 `AGENT_RUN_BLOCK_TYPES`。mxc:// 换算提取为 `lib/matrix-media.ts` 的 `mxcToDownloadUrl`（MarkdownMessage 与 AttachmentCard 共用），homeserver 从 `useMatrixStore` 取，预览上限 256KB。
  - vitest 中 mock ES class：`vi.fn().mockImplementation(() => ({...}))` 作构造器时 `new` 返回的是 `this` 而非返回对象，mock 类必须用真实 `class` 定义（A2uiMessage.test 踩过）。测试用 `@testing-library` 若未配置 auto cleanup，需在每个 describe 里 `afterEach(cleanup)` 防 DOM 累积。
