# ChatRoom.tsx 拆分（Phase 1） — Task List

- [x] 1. 新增 `src/components/dashboard/sections/chat/hooks/usePersistedDraft.ts`：基于 roomId 的 localStorage 持久化 hook，返回 `{ value, setValue, setValueLocal, clear }`，adjust-state-during-render 恢复模式
- [x] 2. 新增 `src/components/dashboard/sections/chat/hooks/useFileUpload.ts`：封装 image/file 上传到 Matrix + 发送 m.image/m.file 消息的完整流程，接受 mutation 函数 + local message helpers 作为参数
- [x] 3. 新增 `src/components/dashboard/sections/chat/hooks/useFileDropZone.ts`：基于 container ref 的 drop zone hook，返回 `{ dragActive, dropZoneProps }`，正确处理子元素 drag 冒泡
- [x] 4. 新增 `src/components/dashboard/sections/chat/components/DragDropOverlay.tsx`：受控展示组件，absolute 覆盖整个区域显示拖拽提示
- [x] 5. ChatRoom.tsx 接入 4 个新模块：删除原 draft/upload/drag 内联代码，替换为 hook/组件调用；行为不变
- [x] 6. 单测：usePersistedDraft 7 例、useFileUpload 5 例、useFileDropZone 4 例、DragDropOverlay 3 例；ChatRoom.test.tsx 不改（行为不变）
- [x] 7. typecheck + lint + 全量 138 文件 1207 用例通过；CHANGELOG Unreleased "Improvements" 段记录

## 验收结果

- ChatRoom.tsx: 1040 → 966 行（-74，-7%）
- 全量测试: 0 回归，+19 新用例
- typecheck / eslint: 全绿

## 后续 Phase（不在本 PR）

- Phase 2: worker pane resize 抽 `useWorkerPane` hook
- Phase 3: edit session / reply / 系统通知抽 `useChatActions` hook
- Phase 4: 把 ChatRoom 进一步拆成 `<ChatHeader>` + `<ChatTimeline>` + `<ChatSidebar>` 三个独立展示组件