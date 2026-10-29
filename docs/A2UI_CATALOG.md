<!--
  A2UI 与运行时块协议目录（方案 v3 F-1）。

  解决问题：
  过去只有内部源码和 PRD 片段记载 Matrix 消息里可以塞哪些结构化块；外部 runtime、
  新的 Coding Agent（如 QwenPaw、OpenClaw）以及自定义 Worker 接入时，缺少明确的
  「我能发什么块、格式是什么、发错或版本不匹会怎样」公开目录。

  关键取舍：
  1. 宁可降级也不丢消息：协议解析失败或遇到未知版本时，永远平滑回退到 Markdown 启发式，
     绝不因为解析异常隐藏或丢弃整条消息；
  2. 纯文本双写：建议 Runtime 发送时保留可读的 body 摘要，保证脱离 Web 界面（终端、
     老客户端）依然完全可读；
  3. 消费侧先行：v2 干预与审查报告在 Dashboard 先行定义好消费契约，上游支持后无缝生效。
-->

# A2UI 与运行时块目录（Runtime Block Catalog）

本文档定义 AgentTeams 协作空间中支持的 **8 类运行时块（Runtime Block）** 渲染规范，供外部 Runtime、Agent 框架（如 QwenPaw、OpenClaw 等）接入时参考。

信封载体：Matrix 消息事件的 `content['org.agentteams.run']` 字段。
协议源码：`src/lib/a2ui/protocol.ts` 与 `src/lib/a2ui/parser.ts`。

---

## 1. 协议信封规范

```json
{
  "org.agentteams.run": {
    "version": "1",
    "run_id": "run-20261028-001",
    "step_id": "step-planner",
    "blocks": [
      /* 块数组 */
    ]
  }
}
```

- **`version`**（可选，推荐 `"1"`）：`"1"` 为归一化协议；`"0"` 或缺省为宽松 legacy 结构。如果信封版本为未知字符串，Dashboard 解析器不会丢弃消息，而是**整体平滑回落为正文文本启发式解析**。
- **`run_id`**（可选）：关联同一轮次执行的多条消息，用于时间线汇聚。
- **`step_id`**（可选）：当前执行步骤的标识符。
- **`blocks`**（必填）：按顺序排列的块数组。

---

## 2. 8 类块渲染器目录

### 2.1 正文文本块 (`type: 'text'`)

用于普通的模型输出、总结与对话正文。

```json
{
  "type": "text",
  "text": "任务已规划完毕，请查阅下方接力卡。",
  "isStreaming": false
}
```

- **降级行为**：若解析失败，直接显示为消息气泡正文。

---

### 2.2 思考过程折叠块 (`type: 'thinking'`)

用于展示 Agent 的 Chain-of-Thought（CoT）推理过程，在时间线中默认作为“过程（思考 N）”折叠，可展开查阅。

```json
{
  "type": "thinking",
  "content": "先分析需求：用户要求订单支付回路支持幂等令牌...",
  "isStreaming": false
}
```

- **降级行为**：若缺失，回落为普通引用或文本显示；正文中 `<details class="thinking">` 或 `Thinking:\n\n` 均能被启发式捕获。

---

### 2.3 工具调用卡 (`type: 'tool_call'`)

展示 Agent 对外部工具或 MCP Server 的调用，包含参数、执行状态与返回结果。

```json
{
  "type": "tool_call",
  "payload": {
    "tool_name": "execute_shell_command",
    "arguments": {
      "command": "git status"
    },
    "status": "succeeded",
    "tool_call_id": "call-001",
    "result": "On branch main\nnothing to commit",
    "started_at": 1730100000000,
    "finished_at": 1730100001200
  }
}
```

- **`status` 枚举**：`'pending'` | `'running'` | `'succeeded'` | `'failed'`。
- **降级行为**：缺失 `status` 时默认按 `'running'` 渲染；正文中以 `🔧 **tool_name**` 开头的 Markdown 代码块会被文本启发式归一化为同构卡片。

---

### 2.4 人工干预与审批卡 (`type: 'confirmation'`)

用于触发人机回路（HITL）。包含单选、多选、自由输入等多种选项，提交后自动生成 `com.agentteams.answer` 结构化回写并落审计日志。

```json
{
  "type": "confirmation",
  "payload": {
    "confirmation_id": "conf-db-migration-01",
    "tool_name": "apply_database_migration",
    "question": "即将执行生产数据库迁移，是否放行？",
    "options": [
      { "id": "approve", "label": "确认执行迁移", "recommended": true },
      { "id": "backup", "label": "先备份数据快照" },
      { "id": "reject", "label": "拒绝操作" }
    ],
    "multi_select": false,
    "expires_at": 1730101800000
  }
}
```

- **必填项**：`confirmation_id` 与 `tool_name`（或 `question`）。
- **降级行为**：若未传 `options`，回落为标准的两按钮（批准 / 拒绝）Legacy 工具确认卡；若缺失 `confirmation_id`，回退文本启发式。

---

### 2.5 工作流接力卡 (`type: 'workflow'`)

用于多 Agent 团队或复杂任务流转展示，清晰呈现节点状态（等待、运行、成功、失败）。

```json
{
  "type": "workflow",
  "payload": {
    "id": "wf-release-pipeline",
    "name": "生产发布与验证流水线",
    "status": "in_progress",
    "current_step_id": "step-build",
    "items": [
      { "id": "step-lint", "name": "静态代码门禁", "status": "completed" },
      { "id": "step-build", "name": "容器镜像构建", "status": "in_progress" },
      { "id": "step-deploy", "name": "金丝雀部署", "status": "waiting" }
    ]
  }
}
```

- **降级行为**：若未携带步骤，仅显示任务主进度条。

---

### 2.6 结构化审查报告卡 (`type: 'review.report'`)

用于代码审查、安全扫描或制品验收，支持标注轮次、判定结论（通过/需修订/阻塞）及具体问题清单。

```json
{
  "type": "review.report",
  "payload": {
    "round": 1,
    "verdict": "pass",
    "title": "安全扫描报告",
    "summary": "未发现漏洞，发现 1 项建议性配置调整。",
    "project_id": "proj-101",
    "issues": [
      {
        "id": "issue-01",
        "severity": "suggestion",
        "anchor": "src/config.ts:15",
        "repro": "建议将超时配置由默认 5s 提高为 10s"
      }
    ]
  }
}
```

- **`verdict` 枚举**：`'pass'`（通过） | `'revision_needed'`（需修订） | `'blocked'`（阻塞）。
- **降级行为**：若上游 Runtime 未提供此块，审查内容回落为普通 Markdown 文本输出，Outcome 由 run-ending 哨兵表达。

---

### 2.7 动态交互界面卡 (`type: 'a2ui'`)

基于 `@a2ui/web_core` 渲染原生的动态 A2UI 表单与组件。

```json
{
  "type": "a2ui",
  "messages": [
    {
      "version": "v0.9",
      "createSurface": {
        "surfaceId": "user-form",
        "root": "root-box"
      }
    }
  ]
}
```

- 支持通过 HTML 注释 `<!--a2ui:{...}-->` 或代码块 ````a2ui {...}```` 嵌入。
- **降级行为**：若 A2UI 渲染引擎报错，展示降级代码块并标注协议版本。

---

### 2.8 运行收尾哨兵 (`type: 'error'`)

表示当前 Agent Run 的异常结束状态，阻止时间线进入未完结的悬挂动画。

```json
{
  "type": "error",
  "payload": {
    "kind": "failed",
    "title": "Worker 容器异常崩溃退出"
  }
}
```

- **`kind` 枚举**：`'cancelled'`（主动取消） | `'failed'`（失败） | `'quiet'`（静默收尾）。

---

## 3. 降级与前向兼容原则（Forward Compatibility）

1. **协议不降频丢包**：遇到无法解析的版本或未知块类型，解析器静默跳过或降级到 Markdown 正文，绝对不会阻断整条 Matrix 消息的投递。
2. **纯文本双写推荐**：Runtime 发送带结构化块的消息时，建议在 `content.body` 中保留可读的 Markdown 纯文本摘要，使得未升级 Dashboard 或命令行客户端亦可阅读。
3. **安全过滤**：所有块 payload 均经过前端纯净净化（DOMPurify），未知属性在归一化阶段被移除，防止跨站脚本注入。

---

## 4. 新增块类型流程（Developer Workflow）

若需要向 Dashboard 新增一种全新的 A2UI 块类型，按以下 4 步接入：

1. **定义类型契约**：
   在 `src/lib/a2ui/protocol.ts` 中声明 `RuntimeXxxBlock` 接口，并扩充 `RuntimeBlock` 联合类型。
2. **编写归一化与校验函数**：
   在 `protocol.ts` 中实现 `normalizeXxxPayload(raw: unknown)`，并在 `normalizeRuntimeBlock` 挂载对应的分支，补充缺省安全默认值。
3. **实现渲染器组件**：
   在 `src/components/dashboard/sections/chat/views/` 创建对应的卡片渲染组件（如 `xxx-card.tsx`），保证符合项目 A-1 语义状态色和 A-3 排版标度。
4. **接入 MessageBubble 调度**：
   在 `MessageBubble.tsx` 中分发该块的渲染分支，并在单测中添加至少一条正向与一条降级异常用例。
