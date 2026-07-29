# Matrix 聊天体验优化需求

## 引言

本功能优化 AgentTeams Dashboard 的 Matrix 聊天阅读与流式响应体验。功能复用 Matrix 消息、编辑事件和 A2UI 内容协议，不新增 LLM 或 SSE 服务端接口。

## 术语表

- **流式消息**：Matrix 房间中通过消息编辑事件持续更新的同一条回复。
- **消息根事件**：被编辑消息的原始 Matrix 事件。
- **思考卡片**：呈现模型思考文本的可折叠内容块。
- **工具卡片**：呈现工具名称、状态、参数和结果的可折叠内容块。
- **完整 Markdown**：包含 GFM、代码块、表格和数学公式的消息内容渲染。

## 需求

### 需求 1：流式消息聚合

**用户故事：** 作为聊天参与者，我希望持续更新的回复显示为单条消息，以便阅读当前回答。

#### 验收标准

1. WHEN Matrix 返回消息根事件及其 `m.replace` 编辑事件，Dashboard SHALL 使用最新编辑内容呈现消息根事件。
2. WHEN Matrix 返回多次编辑同一消息根事件，Dashboard SHALL 在消息列表中呈现一条消息。
3. WHEN 消息内容声明流式状态，Dashboard SHALL 在消息头和内容末尾呈现进行中状态。
4. WHEN 最新编辑内容结束流式状态，Dashboard SHALL 移除进行中状态并保留最终内容。

### 需求 2：流式内容渲染

**用户故事：** 作为聊天参与者，我希望回复生成期间界面保持流畅，并在完成后获得完整格式。

#### 验收标准

1. WHILE 文本消息处于流式状态且内容不包含 Markdown 块级结构，Dashboard SHALL 使用保留换行的轻量文本渲染。
2. WHILE 文本消息处于流式状态，Dashboard SHALL 在内容末尾呈现可见的输入光标。
3. WHEN 文本消息结束流式状态，Dashboard SHALL 使用完整 Markdown 渲染最终内容。

### 需求 3：折叠卡片

**用户故事：** 作为聊天参与者，我希望默认收起已完成的辅助信息，以便聚焦最终回答。

#### 验收标准

1. WHEN 思考卡片处于流式状态，Dashboard SHALL 展开思考卡片并显示进行中图标。
2. WHEN 思考卡片从流式状态变为完成状态，Dashboard SHALL 默认收起思考卡片。
3. WHEN 聊天参与者点击思考卡片或工具卡片标题，Dashboard SHALL 切换该卡片的展开状态。
4. WHEN 聊天参与者手动展开或收起卡片，Dashboard SHALL 在同一消息后续更新期间保留该选择。

### 需求 4：回归保护

**用户故事：** 作为聊天参与者，我希望现有普通消息、媒体消息和 A2UI 表面继续可用。

#### 验收标准

1. WHEN Matrix 返回普通文本或媒体消息，Dashboard SHALL 保持现有消息顺序和媒体渲染。
2. WHEN Matrix 返回 A2UI 表面消息，Dashboard SHALL 继续使用 A2UI 表面渲染器。
3. IF 消息编辑事件缺少有效的根事件引用，Dashboard SHALL 将该事件作为独立消息呈现。
