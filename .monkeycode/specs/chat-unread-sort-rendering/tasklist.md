# 任务清单：聊天未读状态、列表排序与运行时渲染优化

## M1 全局单例同步循环与稳定排序（需求 1、2）

- [x] 1.1 `matrixApi.sync` 支持 `filter` 查询参数透传（`src/lib/matrix-api.ts`）
- [x] 1.2 `RoomMetaStore` 扩展 `activeRoomId` / `setActiveRoomId`（`src/hooks/use-matrix.ts`）
- [x] 1.3 新建 `useGlobalMatrixSync`（`src/hooks/use-global-matrix-sync.ts`）：合并 `useTypingSync` 与 `useTaskSync` 逻辑、构造 sync filter、保留 `loadHistorical` 与 `markEventSeen` 去重、仅选中房间写消息缓存
- [x] 1.4 挂载点改造：`agent-teams-dashboard.tsx` 以 `useGlobalMatrixSync` 替换 `useTaskSync`；`ChatRoom.tsx` 删除 `useTypingSync(roomId)` 调用；`ChatSection` 选择房间时写入 `activeRoomId`；删除 `src/hooks/use-task-sync.ts`
- [x] 1.5 `sortRoomsByRecency` 排序键改造：时间降序 → 无时间戳排尾 → 名称字典序，删除未读优先/@提醒优先前置键（`room-builders.ts`）
- [x] 1.6 测试：`useGlobalMatrixSync` 分发单测、`sortRoomsByRecency` 排序单测更新（含 fast-check 幂等属性）、`ChatRoomSidebar` 组件测试（角标与顺序稳定）
- [x] 1.7 回归：`npm test`（534 基线 + 新增）全绿、`npm run typecheck`、`npm run lint`

## M2 已读双写与阅读位置恢复（需求 3、4、5）

- [x] 2.1 新增 receipt 代理路由 `src/app/api/matrix/rooms/[roomId]/receipt/route.ts`
- [x] 2.2 `matrixApi.sendReadReceipt`；`markAllRead` 双写 `m.read` + `m.fully_read`
- [x] 2.3 进入房间不推进阅读位置；初始滚动到未读分割线；`ScrollPanel` 增加 `scrollToItem(key)`
- [x] 2.4 分割线 label 附带未读条数
- [x] 2.5 测试：双写单测、TimelinePanel 组件测试、MessageBubble ✓/✓✓ 组件测试

## M3 归一化渲染管线与流式中间态（需求 6、7、8）

- [x] 3.1 新建 `src/lib/a2ui/normalize.ts`（9 条优先级分派，复用现有 parser 子步骤）
- [x] 3.2 `MessageBubble` 改走 `normalizeToBlocks`；删除 `markdown-message.tsx` 的 `parseCustomBlocks`
- [x] 3.3 删除死代码 `legacyToA2uiMessages` / `thinkingToA2uiMessages`（`parser.ts:407-501`）
- [x] 3.4 `MarkdownMessage` 增加 `isStreaming` 轻量路径与流式光标
- [x] 3.5 测试：normalize 单测（九条规则）、流式容错单测、MessageBubble 组件测试

## M4 A2UI 流式容错与长消息附件（需求 6-7 规则、9）

- [x] 4.1 A2UI 流式容错：未闭合 fence/注释在 `isStreaming` 时产占位块
- [x] 4.2 `@a2ui/web_core` 0.10.3→0.10.6、`@a2ui/react` 0.10.1→0.10.2 升级，`A2uiMessage` 增加异常兜底
- [x] 4.3 `com.agentteams.long_message` → `AttachmentCard`；提取 `lib/matrix-media.ts`
- [x] 4.4 测试：流式容错单测、AttachmentCard 组件测试

## M5 回归与真实环境验收（需求 10）

- [x] 5.1 全量测试、typecheck、lint 通过
- [ ] 5.2 真实 AgentTeams 集群手工验收 E1-E9
