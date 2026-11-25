# Issue: 总览第一个菜单（首页）改版方向决策

| 项 | 内容 |
| --- | --- |
| 类型 | Feature proposal（设计决策 + 实施方案） |
| 日期 | 2026-11-21 |
| 状态 | 待评审 |
| 读者 | 产品 / 设计 / 前端 |
| 上游契约 | 无改动（纯前端 section 层） |

---

## 1. 背景

侧栏第一个菜单是「首页」（`workspaceMenus[0]`，section id `overview`），落地组件为 `WorkspaceHome`。用户提供了 10 张首页设计稿（AGENTVERSE 系列，青绿强调色 + 编辑排版风格），要求决策改版方向：**做成可插拔的页面模块样式，还是选定一套好的样式直接修改**。

本 proposal 基于代码调研给出结论与实施方案。

---

## 2. 要解决的问题

1. 现有首页（`src/components/dashboard/sections/workspace-home.tsx`，110 行）信息架构单薄：hero + 4 项指标 + 「正在推进」列表 + 「工作区资产」列表，无命令入口、无 HITL 待办、无插件扩展位。
2. 仓库内已有但**未挂载**的资产：
   - `src/components/dashboard/sections/hitl-inbox-card.tsx`（255 行）：HITL 待确认 + 暂停项目 + Matrix 邀请收件箱，逻辑与测试完备，无任何引用。
   - `src/components/plugins/plugin-widgets.tsx`：`dashboard-widget` 扩展点宿主（错误边界 + Suspense），只有自己的测试引用，未挂载。
3. `overview-section.test.tsx` 固化了一条断言：`container.childNodes` 长度为 1，即首页只渲染 WorkspaceHome。这是早期精简的残留，改版时需放开。
4. 设计稿中多个模块（周目标、日度完成时序、Agent 实时贡献率、协作人在线）缺少数据源，需区分「现有数据可支撑」与「需上游新契约」。

---

## 3. 调研：10 张设计稿逐一分析

| # | 名称 | 核心形态 | 与现有资产的关系 | 数据依赖缺口 |
| --- | --- | --- | --- | --- |
| 1 | STUDIO | 左右分屏：左对话、右实时交付物（周报） | 对话 = 助手菜单；交付物 = 资产中心。与首页职责重复 | 周报生成链路 |
| 2 | Card Dashboard | 问候 + 周目标环图 + 协作人 + 任务清单 + 资产 + AI 入口 | 与现有 hero/metrics 同构，信息密度低 | 周目标实体、日度时序 |
| 3 | ORBIT | 围绕单一目标的径向协作图 | 与团队详情 `interactive-team-topology.tsx` 重复 | 目标-贡献映射 |
| 4 | Tabbit Dashboard | 通用 SaaS 仪表盘：KPI 行 + 进度条 + 活动流 + 周图表 | 与现有结构最近，但风格通用，稀释产品辨识度 | 日度完成时序 |
| 5 | TODAY | 深色时间叙事：Agent 今日推进 N 项 + 三列状态 + 底部数字条 | 与 HITL「需要你」模块呼应 | 今日聚合（可由 task board 派生） |
| 6 | Minimal Focus List | 极简：问候 + 今日三件事 + 编排输入框 | 可作为首页「今日焦点」区块 | 无（现有任务足够） |
| 7 | COMMAND | 单任务推进器：需求拆解 → 多 Agent 协作 → 验收 | 对应任务层级 + `org.agentteams.run` 阶段 | 阶段模型（可派生） |
| 8 | Agent 指挥中心 | 深色运维控制台：运行状态 + 暂停/继续 + 实时日志 | 与「观测与治理」菜单及 monitor-panel 插件重复 | Agent 运行态 |
| 9 | PIPELINE | 三阶段流水线（理解/协作/交付） | 属于工作台任务页，非首页 | 阶段模型 |
| 10 | WORKSPACE | 一站式 AI 工作台：slogan + 命令编排器 + 实时协作图 + 今日焦点 + 资产 | **与现有 slogan「一站式AI工作台 / 构建-协作-治理」同源**，增量演进 | 实时协作图（已有 topology） |

### 3.1 现有首页资产盘点（代码事实）

- slogan 与 CTA：`workspace-home.tsx:83-91`（一站式AI工作台 + 与AT助手对话 + 查看任务）
- 时钟：`workspace-home.tsx:30-49`（`WorkspaceClock`，分钟级对齐）
- 指标条：`workspace-home.tsx:74-102`（协作团队 / Agent / 任务 / 模型·技能·工具）
- 任务列表：`workspace-home.tsx:60-62,103-106`（`mainTasks` + `subtaskProgress`，取前 3 条活跃任务）
- 资产列表：`workspace-home.tsx:68-73,107`（模型 / 技能 / MCP 工具计数）
- 权限门控：`level >= 3` 才显示 AT 助手按钮（`workspace-home.tsx:89`）
- 样式：`workspace-home.module.css`（hero 用 `public/images/workspace-night.webp` 背景 + container query 字号）

---

## 4. 核心决策

### 4.1 结论

**选定第 10 套 WORKSPACE 为改版基线直接修改**，同时把首页改成「固定布局 + 命名插槽」的插件可填充结构。**不做 10 套可插拔页面皮肤市场。**

### 4.2 理由

1. **品牌首印象是产品身份，不是用户偏好项。** 首页 slogan 已是「一站式AI工作台 / 构建-协作-治理」，与 WORKSPACE 设计稿（#10）文案同源；把首页做成 10 选 1 的皮肤市场会稀释产品定位，也超出「菜单改版」的诉求。
2. **数据契约无法统一。** 10 套是全页级布局，多数依赖现有系统不存在的实体（周目标、日度完成时序、Agent 贡献率、协作人在线）。做可插拔页面要么造 10 套空态，要么承诺无法交付的数据。
3. **工程成本与收益不成比例。** 可插拔页面需要布局引擎、插槽契约、选择持久化、每套的无障碍与空态、10 套回归测试；而仓库已有 `dashboard-widget` 扩展点与现成宿主，接回即可获得卡片级扩展能力。
4. **WORKSPACE 是唯一与现有 slogan/CTA/指标同构的稿。** 改版是重做视觉与信息架构，不是推倒重写；时钟、指标条、任务聚合逻辑可全部保留。
5. **设计稿 #5 TODAY / #6 Focus List / #7 COMMAND 的优秀模块降级为内置区块**（HITL 待办、今日焦点、任务推进器），而不是各自成为一整套页面。

### 4.3 各设计稿归属裁定

| 设计稿元素 | 裁定 |
| --- | --- |
| #10 WORKSPACE 整体 | 采纳为首页基线 |
| #6 Focus List「今日三件事」 | 降级为首页「今日焦点」区块 |
| #5 TODAY「需要你 / HITL」 | 降级为首页待办区块（复用未挂载的 `HitlInboxCard`） |
| #7 COMMAND 任务推进器 | 降级为焦点卡内嵌进度（复用 `subtaskProgress`） |
| #2/#4 指标条与进度条 | 吸收进指标条与任务行样式 |
| #1 STUDIO 对话+交付分屏 | 归助手菜单 + 资产中心 |
| #3 ORBIT 径向图 | 归团队详情（已有 topology） |
| #8 指挥中心 | 归观测与治理菜单 + monitor-panel 插件 |
| #9 PIPELINE | 归工作台任务页 |
| #5 深色主题 | 不做首页默认；由既有主题系统承载 |

---

## 5. 提议方案

### 5.1 首页信息架构（WORKSPACE 基线）

```
┌──────────────────────────────────────────────────────┐
│ Hero: slogan「一站式 AI 工作台」+ 时钟 + CTA            │
│       ├─ 主 CTA: 与 AT 助手对话（level >= 3）           │
│       ├─ 次 CTA: 查看任务                               │
│       └─ [插槽 hero-aside] 实时焦点任务卡（进度 + 跳转） │
├──────────────────────────────────────────────────────┤
│ 指标条: 进行中 / 本周完成 / 协作成员 / 工作区资产        │
├──────────────────────────────────────────────────────┤
│ [插槽 hitl] HITL 待确认（复用 HitlInboxCard，空态折叠）  │
├──────────────────────────────────────────────────────┤
│ [插槽 composer] 命令编排器（输入 → AT 助手会话）         │
├──────────────────────────────────────────────────────┤
│ 今日焦点（前 3 条活跃任务 + 进度 + 负责人 + 跳转）        │
├──────────────────────────────────────────────────────┤
│ 工作区资产（模型 / 技能 / MCP 工具，计数 + 跳转）         │
├──────────────────────────────────────────────────────┤
│ [插槽 plugin-widgets] 插件卡片网格（PluginWidgetsGrid） │
└──────────────────────────────────────────────────────┘
```

### 5.2 命名插槽（插件化填充方式）

首页自身布局保持固定（保证产品一致性与可预测性），对外暴露**命名插槽**，插件通过既有 `dashboard-widget` 扩展点注册的卡片落入 `plugin-widgets` 插槽：

| 插槽 | 内容 | 来源 |
| --- | --- | --- |
| `hero-aside` | 实时焦点任务卡 | 内置 |
| `metrics` | 4 项指标 | 内置 |
| `hitl` | HITL 待确认 / 邀请 | 内置（接回 `HitlInboxCard`） |
| `composer` | 命令编排器 | 内置 |
| `focus-list` | 今日焦点任务 | 内置 |
| `assets` | 工作区资产 | 内置 |
| `plugin-widgets` | 插件卡片网格 | 插件（`dashboard-widget`） |

不新增扩展点，不改插件 API 契约；`PluginWidgetsGrid` 直接挂载到首页尾部。

### 5.3 视觉语言

- 强调色沿用设计稿青绿（近似 lime-300），通过主题 token 落地，兼容既有 32 色主题系统，不硬编码色值。
- 字体层级沿用现有 clamp + container query 方案（`workspace-home.module.css`）。
- 深浅色由主题系统承载，不在组件内写死。

### 5.4 数据口径（可交付 / 需降级）

| 指标 | 口径 | 状态 |
| --- | --- | --- |
| 进行中 | `mainTasks` 中活跃态条数 | 现有数据 |
| 本周完成 | task board 中 completed 且完成时间在本周 | 前端聚合（新增） |
| 协作成员 | teams + workers + managers 计数 | 现有数据 |
| 工作区资产 | 模型 + 技能 + MCP 工具 | 现有数据 |
| 今日焦点 | 活跃任务取前 3 | 现有数据 |
| HITL 待确认 | `useHitlInboxStore` | 现有数据 |
| 协作人在线 | Matrix presence | 缺失 → 不承诺，槽位预留 |
| 周目标 / 贡献率 / 日度时序 | 无实体 | 缺失 → 不承诺，Phase 3 评估 |

---

## 6. 实施范围

| 阶段 | 内容 | 门槛 |
| --- | --- | --- |
| P0 | 首页按 WORKSPACE 基线重做；接回 `HitlInboxCard`；挂载 `PluginWidgetsGrid`；放开 `overview-section.test.tsx` 的单节点断言 | 必修 |
| P1 | 命令编排器（composer）+ 今日焦点（focus-list）+ 本周完成前端聚合 | 应做 |
| P2 | 精选 2-3 套布局预设（workspace / today / command）作为**限定集合**供用户切换；周目标与贡献率（依赖上游契约） | 可选 |

P2 若推进，也只做限定 2-3 套预设，仍不做 10 套可插拔页面市场。

---

## 7. 备选方案与不选的原因

| 备选方案 | 不选的原因 |
| --- | --- |
| A. 10 套可插拔页面模块（皮肤市场） | 稀释产品身份；数据契约无法统一；布局引擎 + 10 套空态/无障碍/测试成本远超收益 |
| B. 只改样式，不做任何插件化 | 丢掉扩展性；`PluginWidgetsGrid` 与 `dashboard-widget` 扩展点继续闲置，插件生态断链 |
| C. 全盘重写首页 | slogan、时钟、指标条、任务聚合都是有效资产，重写无收益且回归面大 |
| D. 采纳 #4 Tabbit 通用仪表盘 | 风格通用，与「一站式AI工作台 / 构建-协作-治理」定位不符，辨识度低 |
| E. 采纳 #3 ORBIT 径向图为主视觉 | 与团队详情 topology 重复，首页放单目标视图会挤掉多任务视角 |

---

## 8. 影响面

- **涉及区块**：总览（首页）section、插件系统（挂载宿主）、HITL 收件箱（挂载）、导航（无变化）。
- **Controller / 上游契约**：无改动。全部数据来自既有 hook（`useWorkers` / `useTeams` / `useManagers` / `useApiTaskBoard` / `useModels` / `useSkills` / `useMcpServers` / `useHitlInboxStore`）。
- **权限**：保持 `level >= 3` 才显示 AT 助手入口；HITL 卡片内部已有等级与空态处理。
- **测试面**：`overview-section.test.tsx`（放开单节点断言）、`workspace-home.test.tsx`（新增）、`plugin-widgets.test.tsx`（已有）、a11y-axe 用例。
- **文档**：`docs/` 或 `.monkeycode/docs/模块/Dashboard.md` 中首页描述需同步。

---

## 9. 验收口径

1. `./node_modules/.bin/tsc --noEmit` 通过。
2. eslint 对改动文件 0 错误。
3. vitest：`overview-section` / `workspace-home` / `hitl-inbox-card` / `plugin-widgets` 相关用例通过；a11y-axe 无 critical/serious 违规。
4. 首页渲染顺序为 hero → 指标条 → HITL 待办 → composer → 今日焦点 → 资产 → 插件卡片。
5. 空态不塌陷：无任务、无 HITL、无插件卡片时页面结构与文案完整。
6. 权限适配：L1/L2 下隐藏 AT 助手入口，其余区块正常。
7. 插件卡片可经 `dashboard-widget` 注册并出现在首页尾部，插件禁用后消失且不留死链。
8. 不触碰任何 Controller / 上游 API 契约（diff 中无 `src/lib/agentteams-api.ts` 契约变更）。

---

## 10. 风险与依赖

| 风险 | 缓解 |
| --- | --- |
| HITL 卡片挂载后首页渲染成本上升 | 已有 useMemo/稳定引用优化；挂载后观察渲染频率，必要时加 Suspense |
| 放开单节点断言后测试面扩大 | 按插槽逐个补测试，不一次性放开 |
| 周完成聚合口径分歧 | P1 明确口径（completed + 本周）并在 UI 标注 |
| 主题强调色与既有 32 色主题冲突 | 强调色走 token，浅/深主题各配一组 |
| P2 布局预设的范围蔓延 | 预设集合上限 3 套，超出走新 proposal |

---

## 附：设计稿位置

解压于 `当前工作区` 内 `.monkeycode-tmp-files/design-drafts/`（10 张 PNG，哈希命名）。原始压缩包：`.monkeycode-tmp-files/f79ab464-新建文件夹.zip`。该目录已在 `.monkeycode-tmp-files/.gitignore` 中忽略，提案评审通过后可按需归档或清理。
