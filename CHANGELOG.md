# 更新日志

本文件记录 AgentTeams Dashboard 的版本发布历史。
## v1.2.4.9 (2026-09-20)

自 v1.2.4 以来合入 39 个 PR 与若干直接提交，覆盖聊天、知识库、项目看板、Worker 详情、模型网关、审计、登录与部署模式等方向。合入前均通过 CI（Lint, Typecheck & Test）与本地 tsc / eslint / vitest 全量验证。

### New Features

#### 聊天

- org.agentteams.run v1 运行时块协议：带版本号的 discriminated union（text / thinking / tool_call / confirmation / error），结构化 tool_call 以 `tool_call_id` 为权威去重键，未知版本降级文本启发式 (#89) @nillikechatchat
- ChatRoom 拆分 Phase 1：`usePersistedDraft` 房间草稿持久化、`useFileUpload` 上传状态机、拖拽上传层；HITL 人机确认卡片 + 中英双语关键词识别 (#89) @nillikechatchat
- 侧栏插件式分类（全部 / 群组 / 私聊）+ 成员数采集链、按时间排序模式（Element / 插件同款）、排序持久化改 `useSyncExternalStore`、`/sync` 未归类房间补齐 (#116) @LUOSENGWA
- 房间列表可拖宽且宽度持久化 + 运行时徽标独立成行 (#122) @LUOSENGWA
- Element 式实时同步：错误透出与同步健康 chip (#123) @LUOSENGWA
- 聊天工作流卡片 live 刷新：15s 轮询 controller 正源 overlay (#120) @LUOSENGWA
- Worker 会话状态点（心跳权威）：worker 列表 / 侧栏 / 聊天头 / 成员列表头像 (#121, #127) @LUOSENGWA
- 点击头像进入 Worker 会话（消费上游 #1295） (#128) @LUOSENGWA
- 侧栏房间分组与消息预览、composer 活动轨道、audit L2 自审入口（直接提交）@nillikechatchat

#### 知识库

- 新增知识库 tab：KB 文件树（四分类）浏览 + wikilink 图谱，workspace-files 数据面（QwenPaw 端点消费） (#105) @LUOSENGWA
- 图谱 v4：2D 簇块布局 + Controller Docker 代理 tarball 只读数据面；任务看板时间排序与 kanban 体验修复 (#125) @LUOSENGWA
- 3D 图谱引擎按需分包回归：three / 3d-force-graph / three-spritetext 经 `next/dynamic` ssr:false 独立 chunk（主 bundle 零 three 字节，2D 偏好用户永不下载）；WebGL 不可用降级横幅 + 一键回 2D (#130) @nillikechatchat

#### 项目 / 任务看板

- 任务交付物点击打开预览对话框（md / 图片 / 文本，1MB 上限），下载收敛进工件 chip (#107) @LUOSENGWA
- 任务流转事件流面板（对齐上游 #1233 读侧） (#119) @LUOSENGWA
- 任务行内任务级检查详情 (#124) @LUOSENGWA
- 项目视图模式与选中项目 localStorage 持久化 (#100) @LUOSENGWA
- 拓扑视图分栏独立滚动 + 时间排序、工件全项目工作流预取计数（直接提交）@LUOSENGWA

#### Worker 详情

- 技能指派清单（全量替换保存）+ 基线重置与保存后显式重启 (#99, #102) @LUOSENGWA
- 运行时配置面板：max_iters / max_input_tokens / loop_config（消费上游 #1231） (#103) @LUOSENGWA
- 频道矩阵面板：状态 / 配置 / QR 配对 / 重启（消费上游 #1219 九端点） (#104) @LUOSENGWA
- 工具执行审批控制：REST 优先双数据面，Docker 兜底由 `AGENTTEAMS_APPROVAL_DOCKER_PLANE` 门控（默认关）；REST 404 区分「跨团队不可见」与「端点未上线」 (#106) @LUOSENGWA（评审修复 @nillikechatchat）
- 内置工具面板（消费上游 #1255） (#129) @LUOSENGWA

#### 模型网关 / Console

- 模型选择器提供 SGLang 服务模型 (#108) @LUOSENGWA
- 模型别名分组 + EQUAL 谓词接受 + 别名组缺失原因说明 (#92) @LUOSENGWA
- Console 会话不可用时网关路由目录只读回退 (#110) @LUOSENGWA
- Higress Console 服务端绑定会话：L1 登录 + 管理员验证后可管模型网关；代理 cookie 回退修「Login required」 (#115) @LUOSENGWA
- 自定义 Console host 白名单缺口：安装器自动合并 + 登录 fail-fast (#118) @LUOSENGWA
- DeepSeek Harness (dsh) 运行时类型 + 连字符运行时值对齐 controller (#97) @LUOSENGWA

#### 审计 / MCP

- Controller 优先审计数据面（本地 JSONL 回退）；L2 自审（服务端强制 scope=self）/ L3 全审 (#113) @LUOSENGWA、@nillikechatchat
- MCP 页新增 wired-workers 列（来自 Controller 部署目录） (#111) @LUOSENGWA

#### 团队 / Human

- Human 权限级别编辑器 + 成员存在性守卫 (#94) @LUOSENGWA
- 建队内联新建 Worker（Leader / Worker 角色选择）+ 模型写前校验 + SOUL 上传（直接提交）@LUOSENGWA

#### 登录与部署模式

- 多用户双轨登录：服务端会话存储、管理员密码验证、L1-via-Matrix 数据面 token、账号 chip + 登出 (#90) @nillikechatchat
- 首次启动后端配置向导：双地址 failover、L1 后端页 + sglang 健康块、请求层 failover + 后台自动重排、SA-less L2 贴 token 登录、预登录重配置逃生口、共享多用户模式加固、安装器 token 门禁可选退出 (#91) @LUOSENGWA
- 无状态部署模式：浏览器持有凭据、零服务端用户态；`MATRIX_HOMESERVER_ALLOWLIST` 强制（未设置返回 403 且零上游调用），`requireAllowlist` 排他校验 (#109) @LUOSENGWA（评审修复与部署文档 @nillikechatchat）
- `AGENTTEAMS_AUTH_DISABLED` 本地模式注入合成本地身份（直接提交）@u012823422

### Security

- files 端点 worker-scoped RBAC + 敏感文件过滤（credentials.yaml 规则 + 递归对象键掩码） (#117) @LUOSENGWA
- workspace-files 代理补服务端 RBAC view 门（直接提交）@nillikechatchat
- setup token 启动展示 + 失效 token 闭包修复 + probe SSRF 过滤加固 (#91) @LUOSENGWA
- 退役上游补丁流程（install/patches），变更一律 PR 化（直接提交）@u012823422

### Bug Fixes

- 网关 HTML 兜底响应改写为可读 502；知识库 HTML 响应 / 401 会话过期可读报错与 `jsonBody` 容错（直接提交）@nillikechatchat
- Controller 项目列表重复 project_id 去重；KB 树 / 内容透出 controller 错误详情（直接提交）@nillikechatchat
- 后合并 review 第二轮修复 (#93)、deepseek-harness 连字符运行时值 (#97)、#99 / #100 评审跟进 (#102) @LUOSENGWA
- 通知面板焦点环条纹与未读行样式；模型选择 fallback 数组稳定化（直接提交）@nillikechatchat
- 项目视图网格行轨道 `minmax(0,1fr)` 修复右栏独立滚动 (#126) @LUOSENGWA

### Improvements / Maintenance

- vitest 显式 pin `NODE_ENV=test`：容器 ambient production 使 React 走生产构建（无 `act`）导致 322 例批量失败的根治（直接提交）@nillikechatchat
- 中性化内部身份测试夹具 (#114) @LUOSENGWA
- fork-PR 合并工作流沉淀（credential fill、merge-lock 重试、force-with-lease 冲突解法）与 CHANGELOG / Wiki 同步（直接提交）@nillikechatchat

### Quality

- 测试规模：210 个测试文件 / 1978 个用例全绿；`tsc --noEmit` 0 错误；`eslint` 0 问题；全部合入经 CI（Lint, Typecheck & Test）验证

### Contributors

- @LUOSENGWA（37 个 PR）
- @nillikechatchat
- @u012823422
- @monkeycode-ai（平台 AI 协作者）

## v1.2.3.1 (2026-08-18)

### New Features

- **任务看板主数据源切换为 Controller API（D5/D8）**：看板数据优先从 Controller API 拉取，MinIO 作为回退源，提升数据一致性与可用性
- **Chat 空状态插图**：Bot 渐变插图 + 消息角标，替代原单一图标
- **流式打字机效果**：流式输出逐字符展示 + 光标动画；纯文本走轻量渲染路径，块级内容走完整 Markdown 渲染
- **工具卡片结构化升级**：
  - 状态点 + 状态徽标变色（成功绿 / 失败红 / 进行中紫），折叠态直接展示错误首行摘要
  - IN/OUT 输入输出区块徽标
  - streaming / thinking 卡片统一圆角与悬停阴影
  - workflow 步骤字形三态：完成勾 / 失败叉 / 进行中转圈 / 待执行虚线环

### Bug Fixes

- 修复流式追加时打字机头部重置（每追加一个字符就从头部重新打字）
- 修复 workflow 待执行步骤误显示转圈动画
- 修复 CI 失败：清理未使用的 `StreamingCursor`，并将 TypingEffect 改为 render-phase 状态调整，规避 eslint `react-hooks/set-state-in-effect` 报错

### Contributors

- @nillikechatchat（yuanhenglizhen2050@163.com）
- @LUOSENGWA（101017075+LUOSENGWA）
- @monkeycode-ai（平台 AI 协作者）

### Version Updates

- Dashboard 发布标签从 `v1.2.3` 更新至 `v1.2.3.1`

## v1.2.4 (2026-08-14)

### New Features

- **问天插件：AI 深度诊断与日志分析合并为「AI 日志分析诊断」**：
  - 填写症状描述 → 点击「AI 日志分析诊断」，一次完成日志实时采集（容器日志 / Agent 会话 / Matrix 消息）与 AI 分析，SSE 进度条 + 流式报告输出；移除原独立的「AI 诊断」按钮与「开始日志分析」入口
  - 诊断 Prompt 重写并贴合 AgentTeams：角色为平台资深 SRE，内置 Controller/Worker（OpenClaw/Hermes/CoPaw）/团队/Human/Matrix/MinIO/Higress AI 网关模块知识与常见故障域清单；输出结构带严重程度徽章、诊断概要表、事件时间线表、按置信度排序的根因分析、可执行修复命令（bash/yaml 代码块）
  - **日志真实进入 Prompt**：容器日志尾部（单容器 16KB / 总量 96KB 上限）、docker inspect facts（state/exitCode/OOMKilled/重启次数）、Agent 会话摘录（12 个文件 / 32KB 上限）随症状描述与 Dashboard 环境快照一起交给 LLM；此前日志只做统计未进入分析
  - 诊断模型可选：默认模型（服务器 `AGENTTEAMS_DEFAULT_MODEL`）、「模型管理」已配置的服务商模型（经 Higress AI 路由解析）、内置别名与自定义别名；API Key 仍仅保存在服务端
  - 报告渲染美化：react-markdown 自定义渲染器（章节分隔线、表格样式、代码块复制按钮、流式光标），报告头部显示所用模型与时间，支持一键复制全文

### Improvements

- **日志收集迁入问天诊断页**：原设置对话框「日志收集」页签整体迁移为「AI 日志分析诊断」卡片的「日志收集配置」功能区（时间范围 / 容器过滤 / 房间过滤 / PII 脱敏 / Matrix 状态提示），参数直接供 AI 诊断复用；设置对话框由 5 个页签精简为 4 个
- 修复服务端解析 LLM SSE 流未缓冲导致的 token 丢失风险（`data:` JSON 跨网络分块时可能被丢弃）
- 清理问天插件死代码（`collectAndAnalyzeLogs`、`InfraLine`、`SEVERITY_LABELS` 等）

## v1.2.3 (2026-08-13)

### New Features

- **问天诊断插件 (WenTian)**: 新增运行时诊断助手插件，提供：
  - 集群健康概览：Worker/Team/Human 分布、基础设施状态（MinIO/Matrix/Higress）、版本一致性检查
  - AI 深度诊断：输入症状描述，调用 AgentTeams SRE 专家 Prompt 模板，输出结构化 Markdown 报告（问题摘要、日志时间线表格、根因分析、临时/根本修复方案、预防措施、需补充信息）
  - 日志分析：SSE 实时进度条展示采集进度（扫描容器 → 拉取日志 → 会话导出 → Matrix 消息 → AI 分析），结果始终可见
  - 诊断报告可一键复制到剪贴板

### Improvements

- **AI 诊断结果 Markdown 渲染**：诊断结果和日志分析结果均支持 GFM Markdown 渲染（表格、代码块、列表等）
- **问天诊断 Prompt 优化**：替换为完整的 AgentTeams SRE 专家故障排查模板，覆盖 7 步分析流程（提炼症状 → 日志扫描 → 时间线重建 → 关联上下文 → 假设验证 → 给出方案 → 缺失信息），12 种常见根因类型
- **SSE 解析修复**：修复 `collectSSE` 函数无法正确解析 `event:` 字段导致所有事件被识别为 `data` 的 bug，进度条现在能实时更新（0%→95%→完成）
- **诊断页面精简**：移除已删除路由导致的 404（`/api/agentteams/troubleshoot`），移除基础设施详情大 Card 和健康检查独立 Card，聚焦核心诊断能力

### Bug Fixes

- 修复问天 AI 诊断 404 错误（troubleshoot 路由已删除，改为复用 `wen-tian/logs` SSE 端点）
- 修复日志分析进度条永远停在 0% 的问题（SSE event 字段未正确解析）
- 修复日志分析完成后结果不显示的问题（running 与结果显示互斥逻辑错误）

### Version Updates

- 默认镜像版本从 `v1.2.2` 更新至 `v1.2.3`
