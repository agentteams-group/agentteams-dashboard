# ChatRoom.tsx 拆分（Phase 1）

## 背景

src/components/dashboard/sections/chat/ChatRoom.tsx 已经 1040 行，承担着 15+ useState、20+ handler、5 个独立关注点（draft/upload/drag/drop/scroll/worker-pane）。每加一个交互都要动这个文件，已经成为 Chat 区演进的主要阻力。

完整拆分需要 3-5 个独立 PR 渐进推进，每个阶段都必须是行为不变的可独立验证提交。

## 目标（Phase 1）

抽出两个高内聚、自包含、与 composer 解耦的关注点：

1. **draft persistence** — 把每房间的输入草稿持久化逻辑（lines 95-118）抽到 `src/components/dashboard/sections/chat/hooks/usePersistedDraft.ts`
2. **file upload + drag-and-drop** — 把上传状态机 + drop overlay + file → Matrix mxc + send（lines 82-84、397-439、519-543）抽到 `src/components/dashboard/sections/chat/hooks/useFileUpload.ts` 和 `useFileDropZone.ts`，导出 `DragDropOverlay` 组件

行为完全不变；只移动代码、不重构语义。

## 非目标

- 不动 composer（chat-composer.tsx）内部
- 不动 upload mutation 本身（src/hooks/use-matrix.ts 的 useMatrixUploadMedia）
- 不动 MessageList / ScrollPanel / ThreadPanel
- 不改 worker pane、reply、edit、drag-resize 等其它 ChatRoom 内部逻辑

## 设计

### usePersistedDraft(roomId)
- 返回 `[value, setValue, clear]`，封装 localStorage 读写（key: `agentteams-chat-draft:${roomId}`）
- 内部用 adjust-state-during-render 模式在 roomId 变化时恢复草稿（与原 ChatRoom 一致）
- 暴露 `clear()` 用于发送/取消编辑后清空（替代散落的 `persistDraft('')` 调用）
- 失败（storage 不可用）静默 fallback 到内存

### useFileUpload({ roomId, isLoggedIn, userId, ... })
- 接收 matrix mutations 与 local message 操作（pushLocal/patchLocal/removeLocal/pushSystemNotice）作为参数
- 返回 `{ isUploading, upload(file) }`
- 内部处理：image 判定 → upload mutation → send mutation → local message 三态（sending/sent/error）+ 错误时 pushSystemNotice

### useFileDropZone({ onFiles })
- 监听 container ref 的 drag enter/over/leave/drop 事件
- 内部维护 dragCounterRef 处理子元素冒泡
- 返回 `{ dragActive, dropZoneProps }`，dropZoneProps 包含 4 个事件 handler

### DragDropOverlay
- 受控展示组件，接受 `{ active: boolean, label?: string }`，绝对定位覆盖整个 chat area
- 文案 + 视觉风格由本组件决定

## 验收

- [ ] usePersistedDraft 单测：写入 → 切换 room → 恢复 → 清除 → 空字符串不写存储
- [ ] useFileUpload 单测：image file 走 m.image、非 image 走 m.file、上传失败时 pushSystemNotice 被调用
- [ ] useFileDropZone 单测：drag enter/leave/drop 计数正确、非 File 类型 drag 不触发
- [ ] DragDropOverlay 单测：active=true 时显示、false 时不显示
- [ ] ChatRoom.tsx 行数下降到约 940-960（-80~100 行）
- [ ] ChatRoom.test.tsx 全部用例继续通过（行为不变）
- [ ] typecheck / lint / 全量 test 通过

## 后续 Phase（不在本 PR）

- Phase 2: worker pane resize 抽 `useWorkerPane` hook
- Phase 3: edit session / reply / 系统通知抽 `useChatActions` hook
- Phase 4: 把 ChatRoom 进一步拆成 `<ChatHeader>` + `<ChatTimeline>` + `<ChatSidebar>` 三个独立展示组件