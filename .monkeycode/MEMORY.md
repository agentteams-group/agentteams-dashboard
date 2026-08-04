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
- Date: 2026-07-29
- Context: Discovered by Agent while verifying resource deletion locking
- Category: Environment Configuration
- Instructions:
  - The workspace currently has no installed Node.js dependencies; `npm test`, `npm run typecheck`, and `npm run lint` cannot resolve their project executables.

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
