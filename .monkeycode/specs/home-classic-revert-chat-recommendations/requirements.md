# Requirements Document

## Introduction

将首页（section `overview`，组件 `WorkspaceHome`）从 WORKSPACE 改版状态回滚到改版提交前的旧版布局（git `00f0582` 状态，即用户截图参考版本：hero 夜景图 + 「一站式AI工作台 / 构建-协作-治理」+ 时钟 + 「与AT助手对话 / 查看任务」+ 焦点任务浮卡 + 4 项指标条 + 「正在推进」+ 「工作区资产」），并在旧版基础上新增两个模块：**对话命令输入框**与**今日推荐**。

## Glossary

- **旧版首页**：`00f0582` 提交时的 `WorkspaceHome` 实现（约 110 行，hero 使用 `public/images/workspace-night.webp`）。
- **WORKSPACE 改版**：`8dfdcb7`–`b6d6968` 五个提交引入的新版首页（助手卡片 composer、LIVE 协作拓扑、今日焦点、HITL 收件箱、插件挂槽、AlimamaDFK 字体）。
- **对话输入框**：参考用户提供第二张图的命令输入组件（占位文案 + 两个 chip + 圆形发送按钮）。
- **今日推荐**：基于当日任务与待办数据生成的推荐条目列表。
- **AT 助手房间**：`managers` 中首个带 `roomID` 的 Manager 房间；深链入口为 `openChatRoom(roomId)`。

## Requirements

### Requirement 1：回滚旧版首页布局

**User Story:** AS 首页用户，I want 恢复到改版前的旧版首页布局，so that 获得熟悉的信息架构与视觉。

#### Acceptance Criteria

1. WHEN 用户打开首页，THE `WorkspaceHome` SHALL 渲染旧版布局：hero（标题「一站式AI工作台 / 构建-协作-治理」、时钟、夜景背景图、焦点任务浮卡）、4 项指标条（协作团队 / Agent / 任务 / 模型、技能和工具）、「今日推荐」与「工作区资产」并排（lower 左右栏）、「正在推进」通栏列表（前 3 条活跃任务）、「工作区资产」列表（模型 / 技能 / MCP 工具）。
2. WHILE 旧版布局生效，THE 首页 SHALL 不再渲染 WORKSPACE 改版模块：LIVE 协作拓扑卡、助手卡片式 composer、今日焦点区块、HITL 收件箱卡、插件挂槽（`PluginWidgetsGrid`）。
3. IF 用户等级低于 3，THE 首页 SHALL 隐藏「与AT助手对话」按钮。
4. WHILE 任务看板加载中或降级，THE 首页 SHALL 在对应位置展示「正在加载任务…」或「任务暂时无法加载，请稍后重试。」文案。
5. WHEN 任务数据为空，THE 首页 SHALL 展示「暂无正在推进的任务」空态。

### Requirement 2：对话命令输入框

**User Story:** AS 首页用户，I want 在首页直接输入指令并发送给 AT 助手，so that 无需先进入助手菜单即可开始对话。

#### Acceptance Criteria

1. WHEN 首页渲染完成，THE 首页 SHALL 展示对话输入框：占位文案「今天想完成什么？交给 Agent 开始...」、两个可切换 chip（「+ 添加上下文」「自动分配 Agent」）与圆形发送按钮。
2. WHEN 用户在输入框填入非空文本并点击发送，THE 系统 SHALL 将文本写入 AT 助手房间的 composer 草稿（`agentteams-chat-draft:{roomID}`）并深链进入该助手会话。
3. IF 输入框文本为空，THE 系统 SHALL 将发送按钮保持禁用态。
4. WHEN 用户点击「+ 添加上下文」或「自动分配 Agent」chip，THE 系统 SHALL 切换该 chip 的选中态并给出视觉反馈。
5. IF 无可用 AT 助手房间，THE 系统 SHALL 仅切换到 chat section 而不写入草稿。
6. WHEN 输入框获得焦点，THE 首页 SHALL 由外层 composer 卡片展示聚焦描边，且不在卡片内部再绘制独立输入框描边。

### Requirement 3：今日推荐

**User Story:** AS 首页用户，I want 在首页看到基于今日状态的推荐行动项，so that 快速知道今天最该处理的事。

#### Acceptance Criteria

1. WHEN 首页渲染完成，THE 首页 SHALL 展示「今日推荐」区块。
2. THE 今日推荐 SHALL 从当日任务看板与 HITL 待确认数据生成至多 3 条推荐，每条推荐包含标题、状态说明与跳转动作。
3. WHEN 用户点击某条推荐，THE 系统 SHALL 跳转至该推荐对应的任务看板（带 project 参数）或会话房间。
4. IF 当日无可用推荐数据，THE 今日推荐 SHALL 展示空态文案。
5. WHILE 任务看板加载中，THE 今日推荐 SHALL 展示加载态而非空态文案。

### Requirement 4：主题与字体一致性

**User Story:** AS 多主题用户，I want 首页在所有主题下视觉统一，so that 不出现突兀的异类字体或色块。

#### Acceptance Criteria

1. WHILE 任一主题（亮色 / 深色 / 暖白 / 高对比）生效，THE 首页 SHALL 仅使用主题令牌颜色与全局字体栈渲染。
2. THE 回滚后的首页 SHALL 不引用 WORKSPACE 改版引入的 `AlimamaDFK` 字体文件。

### Requirement 5：质量门禁

#### Acceptance Criteria

1. THE 改动 SHALL 通过 `./node_modules/.bin/tsc --noEmit`。
2. THE 改动文件 SHALL 通过 eslint（0 错误）。
3. THE `workspace-home` / `overview-section` 相关 vitest 用例 SHALL 全部通过，a11y-axe 无 critical/serious 违规。
4. THE 改动 SHALL 保持 `typography-scan.mjs` 通过。

## 已定决策（2026-11-23 用户确认）

1. **对话输入框位置**：Hero 左侧替代「与AT助手对话」按钮；hero 按钮行不再渲染「查看任务」按钮（任务看板入口保留在「正在推进」标题行）。
2. **今日推荐内容**：混合模式 —— 动态推荐（HITL 待确认 + 活跃任务，上限 3 条，HITL 优先）为主，底部附固定快捷指令 chips（「今天先做什么」「生成本周周报」）。
3. **今日推荐位置**：位于 lower 左栏，与右栏「工作区资产」并排；「正在推进」改为通栏，位于该双栏行下方。
4. **输入框聚焦样式**：聚焦描边由外层 composer 卡片承接（主题色描边 + 柔环），裸 input 不画独立 outline。

详见 `design.md`。
