# 聊天未读状态、列表排序与运行时渲染优化需求

## 引言

本功能优化 AgentTeams Dashboard 聊天模块的三条链路：消息未读/已读状态、会话列表按最新消息排序、各 Agent 运行时（openclaw、qwenpaw、copaw、hermes）响应内容的渲染。全部改动限定在 Dashboard 前端仓库，复用 Matrix Client-Server API 与运行时现有的消息形态，不修改上游 AgentTeams 仓库。流式输出通过对 Matrix `m.replace` 编辑事件的中间态渲染实现，与上游运行时的编辑式流式机制对齐。

## 术语表

- **Dashboard**：本仓库实现的 AgentTeams 管理控制台前端。
- **运行时**：产生聊天消息的 Agent 框架，包括 openclaw（Manager）、qwenpaw（Worker 与 Manager 新栈）、copaw（Worker v1）、hermes（Worker）。
- **全局同步循环**：Dashboard 内唯一的 Matrix `/sync` 长轮询实例，为全部已加入房间分发时间线事件、临时事件和未读计数。
- **房间元数据**：由全局同步循环派生的每房间数据，含最新消息时间戳、未读计数、@提醒计数。
- **已读回执**：Matrix `m.read` 公开回执事件，驱动 homeserver 清零未读计数并向其他成员展示已读状态。
- **完全阅读标记**：Matrix `m.fully_read` 私有账户数据，跨客户端同步用户自己的阅读位置。
- **未读分割线**：时间线中锚定在完全阅读标记之后的分隔线，标识第一条未读消息。
- **编辑式流式**：运行时先发送占位消息、再通过 `m.replace` 编辑事件反复刷新内容的流式形态。
- **A2UI 协议**：以 `<!--a2ui:...-->` HTML 注释或 ```` ```a2ui ```` 代码块嵌入 Matrix 消息的结构化界面消息，版本 v0.9。
- **运行时消息块**：归一化后的消息内容单元，类型为 text、thinking、tool_call、workflow、confirmation、card、a2ui、attachment 之一。

## 需求

### 需求 1：全局单例同步循环

**用户故事：** 作为聊天用户，我希望进入聊天页面后所有房间的状态持续更新，以便不选中房间也能看到新消息。

#### 验收标准

1. WHILE 用户已登录 Matrix，Dashboard SHALL 维持恰好一个 `/sync` 长轮询循环。
2. WHEN 全局同步循环收到同步响应，Dashboard SHALL 为响应中出现的每个已加入房间更新房间元数据。
3. WHEN 用户切换选中房间，Dashboard SHALL 保持全局同步循环的同步令牌并继续增量同步。
4. WHEN 用户登出 Matrix，Dashboard SHALL 终止全局同步循环并使其令牌失效。
5. IF 一次同步请求失败，THEN Dashboard SHALL 在不超过 5 秒的退避后重试同步。

### 需求 2：会话列表按最新消息稳定排序

**用户故事：** 作为聊天用户，我希望会话列表按最新消息时间排序且位置稳定，以便快速找到最近会话。

#### 验收标准

1. WHEN 房间元数据发生变化，Dashboard SHALL 按最新消息时间戳降序排列会话列表，时间戳相同的房间按名称字典序排列。
2. WHEN 某房间收到新消息，Dashboard SHALL 将该房间移至列表中符合最新消息排序的位置。
3. WHEN 用户打开一个存在未读消息的房间，Dashboard SHALL 保持该房间在列表中的当前位置。
4. WHILE 会话列表已展示，Dashboard SHALL 以红点角标呈现未读计数，以加亮样式呈现包含 @提醒的房间。
5. IF 房间缺少最新消息时间戳，THEN Dashboard SHALL 将该房间排列在具备时间戳的房间之后。

### 需求 3：已读状态双写上报

**用户故事：** 作为聊天用户，我希望我阅读消息的行为同时同步给其他成员和我的其他客户端，以便各方看到一致的已读状态。

#### 验收标准

1. WHEN 用户将房间滚动至底部或在该房间发送消息，Dashboard SHALL 向 homeserver 发送指向最新可见消息的 `m.read` 已读回执。
2. WHEN 用户将房间滚动至底部或在该房间发送消息，Dashboard SHALL 向 homeserver 写入指向最新可见消息的 `m.fully_read` 完全阅读标记。
3. WHEN Dashboard 发送已读回执，Dashboard SHALL 乐观清除该房间的未读角标。
4. WHEN homeserver 在后续同步响应中返回已清零的未读计数，Dashboard SHALL 采用服务端计数更新未读角标。
5. IF 已读回执或完全阅读标记写入失败，THEN Dashboard SHALL 在控制台记录错误并保持当前界面状态。

### 需求 4：未读分割线与阅读位置恢复

**用户故事：** 作为聊天用户，我希望打开有未读消息的房间时定位到第一条未读消息，以便从上次阅读位置继续。

#### 验收标准

1. WHEN 用户打开房间且该房间的完全阅读标记早于最新消息，Dashboard SHALL 在完全阅读标记对应事件之后呈现未读分割线。
2. WHEN 用户打开房间且存在未读分割线，Dashboard SHALL 将时间线初始滚动位置定位到未读分割线。
3. WHEN 用户打开房间且完全阅读标记与最新消息一致，Dashboard SHALL 将时间线初始滚动位置定位到最新消息。
4. WHILE 未读分割线可见，Dashboard SHALL 在分割线以下呈现未读消息计数。
5. WHEN 用户打开房间后未滚动至底部，Dashboard SHALL 保持完全阅读标记位于进入房间时的位置。

### 需求 5：自己消息的已读回执展示

**用户故事：** 作为聊天用户，我希望看到自己发送的消息是否被其他成员阅读，以便确认信息触达。

#### 验收标准

1. WHEN 其他成员的 `m.read` 回执时间戳不早于用户自己某条消息的时间戳，Dashboard SHALL 在该消息上呈现已读双勾图标。
2. WHEN 用户自己的消息已发送且无任何其他成员的回执覆盖，Dashboard SHALL 在该消息上呈现已发送单勾图标。
3. WHEN 用户自己的消息处于本地发送中状态，Dashboard SHALL 在该消息上呈现加载图标。

### 需求 6：运行时消息归一化渲染管线

**用户故事：** 作为聊天用户，我希望不同运行时产生的消息都有一致的结构化渲染，以便阅读工具调用、思考过程和最终回答。

#### 验收标准

1. WHEN Dashboard 渲染一条 Matrix 消息事件，Dashboard SHALL 通过统一的归一化入口将事件内容映射为零个或多个运行时消息块。
2. WHEN 消息内容命中多个候选格式，Dashboard SHALL 按归一化入口定义的优先级顺序选择恰好一种格式映射。
3. WHEN 消息内容包含 `agentteams.workflow` 键，Dashboard SHALL 将该消息映射为 workflow 块。
4. WHEN 消息内容包含 A2UI 协议标记，Dashboard SHALL 将该消息映射为 a2ui 块。
5. WHEN 消息正文为 agentscope-runtime Message 对象的 repr 文本，Dashboard SHALL 将该消息映射为 text、thinking 或 tool_call 块。
6. WHEN 消息正文以 `Thinking:` 前缀起始，Dashboard SHALL 将该消息映射为 thinking 块并去除前缀。
7. WHEN 消息内容不包含任何已识别的结构化格式，Dashboard SHALL 将该消息映射为 text 块并使用 Markdown 渲染。
8. WHEN 消息内容声明 `com.agentteams.long_message` 元数据，Dashboard SHALL 将该消息映射为 attachment 块并呈现文件名与展开入口。

### 需求 7：编辑式流式的中间态渲染

**用户故事：** 作为聊天用户，我希望看到回复在生成过程中的中间内容，以便感知任务进度。

#### 验收标准

1. WHEN 消息根事件收到 `m.replace` 编辑事件且编辑内容声明流式状态，Dashboard SHALL 在原位置刷新该消息并呈现流式光标。
2. WHILE 文本消息处于流式状态且内容不含 Markdown 块级结构，Dashboard SHALL 使用保留换行的轻量文本渲染。
3. WHEN 流式消息的编辑事件不再声明流式状态，Dashboard SHALL 使用完整 Markdown 渲染最终内容并移除流式光标。
4. WHILE 消息处于流式状态，Dashboard SHALL 在消息头部呈现流式状态标识。
5. WHEN 同一消息在一次同步批次内收到多个编辑事件，Dashboard SHALL 仅渲染最新编辑内容。

### 需求 8：思考与工具调用消息渲染

**用户故事：** 作为聊天用户，我希望思考过程和工具调用以可折叠卡片呈现，以便聚焦最终回答。

#### 验收标准

1. WHEN thinking 块处于流式状态，Dashboard SHALL 展开思考卡片并呈现进行中图标。
2. WHEN thinking 块结束流式状态，Dashboard SHALL 默认收起思考卡片。
3. WHEN tool_call 块包含工具名称与参数，Dashboard SHALL 在工具卡片中呈现工具名称、状态徽标和参数。
4. WHEN tool_call 块包含工具结果，Dashboard SHALL 在工具卡片中呈现结果内容。
5. WHEN 用户点击思考卡片或工具卡片标题，Dashboard SHALL 切换卡片展开状态并在该消息的后续更新中保留用户选择。

### 需求 9：A2UI 协议渲染与流式容错

**用户故事：** 作为聊天用户，我希望 A2UI 结构化界面在流式更新期间稳定渲染，以便界面内容不闪烁。

#### 验收标准

1. WHEN 消息包含完整的 A2UI 协议标记，Dashboard SHALL 使用 A2UI 表面渲染器呈现。
2. WHEN 流式消息包含未闭合的 A2UI 代码块标记，Dashboard SHALL 呈现加载占位而非将该标记渲染为文本。
3. WHEN A2UI 标记内的 JSON 解析失败，Dashboard SHALL 将该标记内容作为普通文本呈现。
4. WHEN 消息包含 HTML 实体转义的 A2UI 注释标记，Dashboard SHALL 解码实体后解析协议消息。
5. WHILE A2UI 表面收到增量组件更新，Dashboard SHALL 在同一表面内合并更新并保持已有组件状态。

### 需求 10：回归保护

**用户故事：** 作为聊天用户，我希望既有聊天能力在优化后保持可用。

#### 验收标准

1. WHEN 优化交付，Dashboard 既有 534 个自动化测试 SHALL 全部通过。
2. WHEN Matrix 返回普通文本、媒体或线程回复消息，Dashboard SHALL 保持既有的消息顺序、媒体渲染和线程归属。
3. WHEN Matrix 返回 `m.replace` 编辑事件，Dashboard SHALL 保持既有的根事件合并行为。
4. WHEN 用户发送消息，Dashboard SHALL 保持既有的乐观气泡、失败重试和限流提示行为。
