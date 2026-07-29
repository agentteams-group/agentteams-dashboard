# 运行时确认卡片需求

## 引言

Dashboard 需要将 CoPaw、QwenPaw、OpenClaw 和 Hermes 在 Matrix 聊天中发出的待确认请求显示为一致的交互卡片，同时保持思考和工具调用信息易读且可折叠。

## 术语表

- **确认请求**：运行时要求聊天参与者批准或拒绝后续动作的消息。
- **确认协议**：确认请求的消息字段，以及批准和拒绝操作发送回房间的消息内容约定。
- **辅助卡片**：思考过程或工具调用的可折叠消息内容。

## 需求

### 需求 1：跨运行时确认请求呈现

**用户故事：** 作为聊天参与者，我希望各运行时的待确认请求使用一致的卡片呈现，以便快速理解待处理操作。

#### 验收标准

1. WHEN Matrix 消息符合确认协议，Dashboard SHALL 将确认请求呈现为包含运行时标识、操作说明和确认状态的独立卡片。
2. WHEN 确认请求包含批准和拒绝选项，Dashboard SHALL 在卡片中呈现对应操作入口。
3. WHEN 聊天参与者选择确认操作，Dashboard SHALL 向原房间发送确认协议定义的回复内容。
4. WHEN 确认请求已完成、已拒绝或失效，Dashboard SHALL 呈现不可再次提交的最终状态。
5. IF Matrix 消息缺少确认协议要求的字段，Dashboard SHALL 使用现有文本或通用卡片渲染。
6. WHEN Tool Guard 消息同时包含等待审批标题与 `/approve` 指令，Dashboard SHALL 将其识别为确认请求，并发送 `/approve` 作为批准回复和 `拒绝` 作为拒绝回复。

### 需求 2：思考和工具调用可读性

**用户故事：** 作为聊天参与者，我希望思考和工具调用使用简洁的可折叠卡片，以便聚焦主要回复。

#### 验收标准

1. WHILE 思考过程处于流式状态，Dashboard SHALL 展开思考卡片并呈现进行中状态。
2. WHEN 思考过程完成，Dashboard SHALL 默认收起思考卡片。
3. WHILE 工具调用处于执行中，Dashboard SHALL 展开工具调用卡片并呈现执行状态。
4. WHEN 工具调用完成或失败，Dashboard SHALL 默认收起工具调用卡片。
5. WHEN 聊天参与者切换辅助卡片，Dashboard SHALL 在同一消息的后续更新中保持该展开状态。

### 需求 3：运行时兼容性

**用户故事：** 作为集群管理员，我希望不同运行时的消息保持兼容，以便同时使用 CoPaw、QwenPaw、OpenClaw 和 Hermes。

#### 验收标准

1. WHEN CoPaw、QwenPaw、OpenClaw 或 Hermes 提供符合确认协议的消息，Dashboard SHALL 使用同一确认卡片组件渲染消息。
2. WHEN 运行时输出当前已支持的 A2UI、AgentScope repr、Markdown 或普通 Matrix 消息，Dashboard SHALL 保留现有渲染行为。
