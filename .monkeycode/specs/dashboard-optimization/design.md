# AgentTeams Dashboard 优化方案

- 日期：2026-09-28
- 状态：待排期
- 依据：五份调研笔记（项目现状 / 上游 agentteams / Runtime 集成 / 对象存储迁移 / 趋势与吸引力，2026-09-28）及复测证据
- 读者：项目负责人与项目维护者；目标：逐条可开工——每条建议均含动机、做法、验收标准与优先级

## 目录

- **1. 执行摘要**
- **2. 现状与问题（调研证据）**
  - 2.1 架构与代码质量
  - 2.2 上游对齐与 Runtime 集成
  - 2.3 对象存储：MinIO→RustFS 迁移专项的证据基础
  - 2.4 开发者体验与吸引力
- **3. 方案**
  - 3.1 主题一：架构与代码质量（A1–A10）
  - 3.2 主题二：上游对齐与 Runtime 集成（B1–B8）
  - 3.3 主题三：对象存储 MinIO→RustFS 迁移专项（3.3.0–3.3.5、C1–C2）
  - 3.4 主题四：开发者体验与吸引力（D1–D6）
- **4. 优先级与路线图**
  - 4.1 优先级总表
  - 4.2 分阶段路线
  - 4.3 关键依赖链
- **5. 风险与未决问题**
- **附录：证据来源与可信度说明**

---

## 1. 执行摘要

项目基本盘是健康的：本次实测 `npm run typecheck` 0 错误、`npm run lint` 0 错误（27 警告）、`npm test` 全量 213 文件 / 2011 用例中 1999 通过、12 失败；安全治理（middleware 身份头 `src/middleware.ts:29`、RBAC 引擎 `src/lib/rbac-engine.ts`、append-only JSONL 审计 `src/lib/audit-log.ts:46-47`）已体系化，`docs/code-review-issues.md:7-23` 的 SEC/FUNC/UI/A11Y 问题已于 2026-09-20 收档。

但调研同时暴露出四类必须处理的问题，构成本方案的四个主题：

1. **架构与代码质量**：测试套件存在唯一可稳定复现的失败源（`src/app/api/agentteams/setup/backends/route.test.ts` 的 10 个用例，mock 机制失效）；生产依赖 13 个漏洞（8 高 5 中，已经官方 registry 复测复现），其中 adm-zip 位于插件解包这一安全敏感路径；Node 20 已于 2026-03-24 EOL 而生产镜像仍运行其上（`Dockerfile:13,44`、`.github/workflows/ci.yml:24`）；5 个超 1000 行巨型文件；lint/tsconfig 基线宽松。
2. **上游对齐与 Runtime 集成**：本仓库是上游 agentscope-ai/AgentTeams 的官方 Web 控制台（上游最新 v1.2.4，2026-09-20 发布，已经 api.github.com 核实），存在待合入的本地实现（Worker env 编辑，对应上游 PR #1306）、runtime 展示内部不一致（deepseek-harness 无卡片/计数）、协议层机会（org.agentteams.run v1 固化）与外部 coding agent runtime（Claude Code / Codex CLI / opencode）接入评估。
3. **对象存储 MinIO→RustFS 迁移**：MinIO 社区版已在 GitHub 归档（api.github.com 2026-09-28 实测 `archived=true`），source-only 状态下连拉新镜像补丁都做不到，迁移动机是安全硬伤而非许可洁癖；本仓库是纯 S3 客户端（调用全部收敛在 `src/lib/minio-client.ts`），**运行面**迁移成本接近零，但二进制替换发生在上游 controller 仓库，需跨仓协作；且新安装链路存在一处条件性适配——安装器凭证探测只认 `AGENTTEAMS_FS_*`/`AGENTTEAMS_MINIO_*` 命名空间，若 controller 切换后不保留别名导出，全新安装的存储面会**静默失效**（见 3.3.1-3b）。
4. **开发者体验与吸引力**：仓库缺 CONTRIBUTING.md 与 issue/PR 模板（`ls .github` 仅 workflows，已核实）；README 多处过期与死链；「多智能体 Mission Control」定位、会话回放、MCP 治理三个差异化故事具备传播条件但尚未包装。

**优先级概览**（明细见第 4 节）：

| 优先级 | 时间窗 | 事项 |
|---|---|---|
| **P0** | 立即执行，约 1-2 周 | A1 修复 setup/backends 测试 mock 失效；A2 非破坏性依赖漏洞清理；A3 Node 20→22 LTS 迁移 |
| **P1** | 2-6 周 | 文档保鲜、巨型文件拆分、lint 基线收紧、Windows 开发脚本、覆盖率扩大、上游 #1306 对齐合入、runtime 一致性收尾、上游漂移检测、org.agentteams.run v1 固化、QwenPaw 迁移收口、RustFS 兼容性回归与决策推动、贡献者入口基线、Mission Control README 改版（其中巨型文件拆分、lint 收紧、覆盖率扩大三项容量超限时**可顺延至 P2 前段**，见 4.1） |
| **P2** | 6-12 周 | 依赖大版本批次、外部 runtime 协议适配器评估、MCP 深化、会话回放卖点、MCP 治理故事、部署模板与 demo 站 |

> 排期约束：CHANGELOG Unreleased 仍有 CoPaw→QwenPaw 停建记录未发版（`CHANGELOG.md:4-7`），且 `src/lib/agentteams-api.ts:12` 的 `WorkerRuntime` 仍含 `'copaw'`，本方案所有涉及 runtime 枚举与发版的排期需与该发版窗口协调（详见第 5 节风险 1）。

---

## 2. 现状与问题（调研证据）

以下问题均给出证据位置（`path:line`）与实测数据，供逐条核对。

### 2.1 架构与代码质量

- 技术栈与形态：Next.js 16 + React 19 + TS 5 + Tailwind v4/shadcn/ui + Zustand + TanStack Query，Node 20+，Docker standalone 输出，当前版本 1.2.4.9（`package.json:3`、`Dockerfile`）。架构为浏览器→Next.js API 代理→Controller/Matrix/Higress/MinIO/Nacos，浏览器不直连后端；`src/app/api` 下共 112 个 route.ts（`find | wc -l` 实测）。
- 质量门实测：typecheck 通过；lint 0 错误 27 警告（15 prefer-const、6 no-unused-expressions、4 个未使用的 eslint-disable、2 个 no-location-assign-relative-destination）；test 1999/2011 通过，12 失败来自 3 个文件，两次全量运行结果一致。
- **测试失败机制（唯一稳定复现源）**：10 个失败来自 `src/app/api/agentteams/setup/backends/route.test.ts`，隔离单跑仍稳定失败（10 failed/25 passed）。机制：测试用 `vi.mock('@/lib/backend-config')`（`route.test.ts:24`）替换 `probeBackend`，但 `refreshEffective`（定义于 `src/lib/backend-config.ts:748`）在模块内部以自有绑定直接调用 `probeBackend`（调用点约 `backend-config.ts:759`，抽验确认），mock 拦截不到；真实探测对不可达主机耗满 4s×2+500ms，超过 5s 用例超时。Linux CI 上 DNS 快速失败所以绿——该测试的「CI determinism」注释（`route.test.ts:16-23`）实际未覆盖其针对的代码路径。另外 2 个失败（manager-url.test.ts、worker-runtime-config-panel.test.tsx）隔离单跑均通过，属全量并行负载下的 5s 超时抖动，非代码缺陷。
- 巨型文件（`wc -l` 实测）：`src/components/dashboard/sections/knowledge-section.tsx` 1899 行、`src/components/dashboard/sections/projects-section.tsx` 1359 行、`src/plugins/wen-tian/index.tsx` 1333 行、`src/components/dashboard/knowledge-graph3d.tsx` 1282 行、`src/components/dashboard/sections/chat/ChatRoom.tsx` 1129 行。
- 基线宽松：`eslint.config.mjs:12,14,26` 关闭 no-explicit-any / no-non-null-assertion / react-compiler 等规则；`tsconfig.json:13` `noImplicitAny: false`；非测试源码 `: any` 子串匹配 39 处（命令：`grep -rn ": any" src --include=*.ts --include=*.tsx | grep -v ".test." | wc -l`；按更严匹配口径为 36 处，两种口径工作量级一致，目标均为清零）；vitest coverage include 仅 6 个路径（theme/plugins 的 lib 与组件 + `src/lib/section-store.ts`，`vitest.config.ts:31-38`），不含 rbac-engine/audit-log/backend-config/minio-client 等安全关键模块。
- 依赖健康度：`npm audit --omit=dev` 实测 13 个生产依赖漏洞（8 高 5 中），并经官方 registry 复测复现。直连依赖 adm-zip 0.6.0 锁在漏洞区间（≤0.6.0，任意文件覆盖 + DoS 两个 high），经 `src/lib/plugins/server-package.ts` 用于插件 zip 解包这一安全敏感路径；`package.json:91` 的 sharp override 下限 `>=0.35.0` 低于修复版 0.35.4；nanoid 3.3.17<3.3.18（high）；mermaid→chevrotain 链嵌套 lodash-es ≤4.17.23（两个 high）；minio→stream-json/decode-uri-component/query-string 链（moderate，audit 建议降级 minio@7.1.3，破坏性，不建议采纳）。
- Node 20 已于 2026-03-24 EOL（来源：nodejs.org 发布政策，联网核实），而 `Dockerfile:13,44` 用 node:20-alpine、`ci.yml:24` 用 node-version 20。近期 commit 7f21a0a 因 isomorphic-dompurify@4 依赖的 jsdom@30 要求 Node≥22.22.2 而被迫降级回 3.19.0——node:20 与生态的漂移成本已开始显现。
- 文档过期（实测并经 grep 复核）：`README.md:324` 称「724 tests across 80 files」（实际 213 文件 / 2011 用例）；`README.md:233` 仍记载 `DATABASE_URL` SQLite 配置（代码中无任何 sqlite/prisma 引用，实际持久化是 JSON 文件，配置路径见 `backend-config.ts:74` 的 configFilePath）；`README.md:85` 称 PowerShell 支持开发中（`install/agentteams-dashboard.ps1` 已存在 322 行且有 CI 验证，`wc -l` 实测）；安装器默认版本描述与 `install/agentteams-install.sh:2486`（`v1.2.4.9`）不符；主题编辑器参数「10+ vs 30+」自相矛盾；`README.md:331` 引用的一篇历史计划文档链接已失效（其目标文件与所在目录均已不存在）。
- Windows 开发体验：`package.json:6,8` 的 dev/start 脚本用 Unix-only 语法（env 前缀 + tee 管道，抽验确认），Windows cmd 无法直接运行；此外 node_modules 与 package-lock.json 脱节时，需先以 `npm ci --no-audit --no-fund --legacy-peer-deps` 同步（965 包）方能忠实运行三个质量门（调研期间即因脱节遭遇假失败）。
- CI 三条流水线齐全（ci/build/install-test），但 Actions 当前实际绿红未能联网核实（gh 无登录态）；CHANGELOG 自述合并前 CI 全绿（`CHANGELOG.md:11`）。

### 2.2 上游对齐与 Runtime 集成

- 本仓库即上游官方控制台：上游 agentscope-ai/AgentTeams 最新发布 v1.2.4（2026-09-20，api.github.com 核实），release notes 明确「Dashboard is bumped to v1.2.4.9」；Dashboard 经上游安装器 PR #1075 并入（2026-07-26 merged），`install/AGENTTEAMS_PATCH.md:5-11` 记录补丁流已退役、后续变更一律向上游 main 提 PR。
- 本仓库 `install/agentteams-install.sh`（4707 行）是上游安装器工作副本：内嵌 `AGENTTEAMS_DASHBOARD_VERSION` 默认 `v1.2.4.9`（`:2486`），与上游 GitHub releases/latest 作版本探测（`:1787`）。该副本与上游 main 的漂移目前无自动检测。
- Runtime 面：`WorkerRuntime = 'openclaw' | 'copaw' | 'hermes' | 'openhuman' | 'qwenpaw' | 'deepseek-harness'`（`src/lib/agentteams-api.ts:12`）；可新建 Worker runtime 仅 4 种（`src/lib/runtime-options.ts:4-9`），Manager 仅 openclaw/qwenpaw（`:12-16`），copaw/openhuman 为 legacy 只读（`:28-31`），copaw 创建被拒并提示迁移 QwenPaw（`:18`）。
- **内部不一致（抽验确认）**：`src/components/dashboard/sections/runtime-section.tsx` 只有 5 张 runtime 卡片（openclaw/copaw/hermes/openhuman/qwenpaw，`:16-60`）、运行时计数也只有 5 种（`:80`），deepseek-harness 已可创建却无卡片/计数；卡片中 QwenPaw 的模型宣传仍只写 Qwen 系，与实际经 Higress 多模型路由不符。另外 KB/workspace-files 面按 qwenpaw→copaw 布局探测但不过滤 runtime，选中其他 runtime 时 404 降级、用户无从得知原因（`docs/code-review-issues.md:164` 已立案描述）。
- 消息协议：Dashboard 解析 Matrix 消息优先识别 `org.agentteams.run` 结构化块（`docs/ARCHITECTURE.md:125-133`：v1 走 `parseAgentRunBlocks` 规范化、v0/缺省透传、未知版本一律降级 13 级文本启发式），上游 runtime 接入此协议后即可替代文本启发式路径。
- 上游动向（api.github.com 核实，2026-09-21~23）：#1306「expose Worker environment editing and gateway identity probes」open 中；#1303 copaw worker 1.0.4 兼容包、#1295 worker chats 只读代理、#1255 built-in tools 代理、#1233 任务状态迁移引擎已 merged。本地分支 `codex/worker-config-gateway`（b1c34f8）与 #1306 同主题同作者（shiyiyue1102），新增 `/api/agentteams/workers/[name]/gateway-probe` 与 worker-env-editor。
- Controller 契约风险：「AgentTeams Controller」源码仓库 higress-group/agentteams 不可公开访问（api.github.com 404，已核实），依赖面契约只存在于 `docs/INTERFACES.md` 与上游 release notes。
- 生态趋势（联网核实，细节见第 5 节未核实清单）：外部 coding agent 正走向结构化会话协议——Codex CLI 的 `codex app-server`（stdio 上 JSON-RPC 2.0：session/approvals/diffs/流式进度）与 Zed 主导的 ACP 已成事实标准，opencode 提供 `opencode serve` 无头 HTTP（带 OpenAPI），Claude Code 官方路径为 Agent SDK（TS，与本仓技术栈同构，自带审批语义可映射到现成 confirmation 块/HITL inbox，`src/lib/hitl-inbox.ts:3-10`）与 `claude -p` headless。

### 2.3 对象存储：MinIO→RustFS 迁移专项的证据基础

- **本仓库是纯 S3 客户端**：唯一依赖为官方 minio npm SDK v8.0.7（`package.json:45`），全部调用收敛在 `src/lib/minio-client.ts`，无裸 SDK 散落；实测确认仅使用 11 个 SDK 方法、共 73 处调用（命令：`grep -rhoE "\.(listBuckets|bucketExists|makeBucket|listObjects|getObject|putObject|statObject|removeObject|removeObjects|presignedGetObject|presignedPutObject)\(" src --include=*.ts --include=*.tsx | sort | uniq -c`）：listObjects×20、getObject×16、putObject×14、removeObject×6、statObject×5、listBuckets×3、bucketExists×3、removeObjects×2、makeBucket×2、presignedPutObject×1、presignedGetObject×1；未使用 bucket policy、versioning、SSE/KMS 加密、copyObject、multipart 高级 API。
- MinIO 服务端运行在 agentteams-controller 容器内（9000 端口），不在本仓库部署（`Dockerfile` 只构建 Next.js 应用，无 docker-compose）。
- **配置契约分两个独立命名空间**（已逐行通读核实）：**dashboard 客户端侧**——`.env.example:84-89` 定义 `AGENTTEAMS_FS_*`（全部注释，由 install 脚本注入）；安装器从 controller 容器 env 探测的回退链为 `AGENTTEAMS_FS_BUCKET→AGENTTEAMS_MINIO_BUCKET`、`AGENTTEAMS_FS_ACCESS_KEY→AGENTTEAMS_MINIO_USER`、`AGENTTEAMS_FS_SECRET_KEY→AGENTTEAMS_MINIO_PASSWORD`、`AGENTTEAMS_FS_ENDPOINT→AGENTTEAMS_MINIO_ENDPOINT→默认 http://{controller}:9000`（`install/agentteams-dashboard.sh:326-342`），其中 BUCKET/ACCESS_KEY/SECRET_KEY **无 else 兜底值**，探测落空仅 warn 后继续（`:392-394`），空凭证不注入 dashboard 容器（`:448-449` 条件注入），运行时 `getMinioConfigFromEnv` 返回 null（`minio-client.ts:58-59`）→ 对象存储面**静默不可用**；`src/lib/minio-client.ts:46-52` 读取优先级为 F1 配置文件 > AGENTTEAMS_FS_ENDPOINT > AGENTTEAMS_MINIO_ENDPOINT（复测确认）。**controller 服务端侧**——两份 install 脚本均不设置 MINIO_ROOT_USER/MINIO_ACCESS_KEY/MINIO_VOLUMES 等服务端变量（grep 零命中，复测确认），controller 容器内 MinIO/RustFS 服务进程 env 本仓不可见、不可核实；RustFS 的 `MINIO_*→RUSTFS_*` 白名单只作用于 RustFS **服务进程** env（docs.rustfs.com/en/reference/environment-variables），**与安装器读取的 controller 容器导出变量无关**——迁移对 dashboard 的影响面由此决定，见 3.3.1-3b。
- **健康探测路径是 MinIO 专有的**：`src/lib/backend-config.ts:486` `minio: { path: '/minio/health/live' }`；`install/agentteams-install.sh:4055` 安装健康检查同为 `http://127.0.0.1:9000/minio/health/live`——这是迁移核对关键点。
- bucket 约定：双 bucket——`AGENTTEAMS_FS_BUCKET`（示例 agentteams-data；worker 侧安装脚本设为 agentteams-storage，`install/agentteams-install.sh:3949-3952`）存 mcp-servers/、shared/tasks/、shared/projects/、agents/、teams/ 前缀；skills bucket 硬编码 `SKILLS_BUCKET = 'skills'`（`src/lib/skill-center-types.ts:57`）。
- presign 语义：`src/app/api/agentteams/storage/presign/route.ts:5` `PRESIGN_EXPIRY_SECONDS = 15 * 60`，敏感文件拒绝签发（统一 404）。
- **MinIO 社区版变化（迁移动机，已核实）**：api.github.com/repos/minio/minio 实测（2026-09-28）`archived=true`、最后 push 2026-04-24、最后 release 为 RELEASE.2025-10-15T17-29-55Z——对应 2025-10-15 起转 source-only（Docker Hub/Quay 停发预编译镜像）；2025-06 社区版剥离 web console、2025-12 进入 maintenance mode、2026 年初归档（归档具体日期为二手转述，归档状态本身已 GitHub API 直接核实）。结论：无 bug fix 与安全补丁，已部署镜像仍可运行但风险随时间上升，且拉不到任何新补丁镜像。
- **RustFS 兼容度（已核实）**：rustfs/rustfs GitHub API 实测 34,043 stars、1.0.0 已 GA、Apache-2.0、活跃（最后 push 2026-09-28）；官方文档 docs.rustfs.com 核实：SigV4 支持，本项目用到的 11 个 SDK 方法全部覆盖；`/minio/health/live` 与 `/minio/health/ready` 为 MinIO 兼容别名、默认启用；`MINIO_ACCESS_KEY/SECRET_KEY/ROOT_USER/ROOT_PASSWORD/ADDRESS/VOLUMES/REGION` 等 env 白名单自动映射 `RUSTFS_*`（默认启用，仅作用于 RustFS 服务进程 env，见上条）；端口约定相同（9000 S3 + 9001 console）。
- RustFS 风险（已核实/转述见第 5 节）：1.0 GA 刚发生（约 2026-09），生产案例积累中；有未息性能 issue（2026-04 object cache 内存占用，转述）；**磁盘级 MinIO 数据兼容仅 Preview（默认构建不含）且加密对象不可读 → 必须走 S3 API 迁移，不能直接复制数据目录**；mc mirror/rclone 迁移不保留对象版本历史（本项目未用 versioning，无影响）。

### 2.4 开发者体验与吸引力

- 贡献者入口缺失：仓库缺 CONTRIBUTING.md、`.github` 下仅有 workflows 无 issue/PR 模板（ls 核实）；`README.md:331` 存在死链（见 2.1）。插件系统（5 类扩展点 + 热更新 + `tools/create-dashboard-plugin` 脚手架，`README.md:62-72`，目录已核实存在）与 `lint:tone` AI 味文案门禁（`package.json:10`）是现成的低门槛贡献路径。
- 独特卖点已有素材但未包装：Worker 全生命周期 + 拓扑视图 + 项目 DAG/loop 干预（暂停/恢复/重规划/取消）与干预记录时间线（`docs/项目.md:91-154`）；Chat 已支持 A2UI 标记、AgentScope runtime Message repr、Tool Guard 确认与 m.replace 流式修订渲染（`README.md:56`），调试日志打包含容器诊断 + agent 会话 + Matrix 消息且默认 PII 脱敏（`README.md:38`）；MCP 双层支持面（MinIO 注册表 CRUD + Controller mcp-catalog per-worker 接线，上游 #1250）与 Higress per-consumer 授权（`docs/INTERFACES.md`，约 :22,48）；技能中心 custom/nacos/builtin 三来源（`docs/ARCHITECTURE.md:81-87`）。
- 行业背景（联网核实，数字多为转述，见第 5 节）：agent teams 模式 2026 年成为主流但框架普遍只提供运行时不提供运维台；MCP 治理/安全成为企业侧头号痛点；会话回放 + tracing 深度是可观测性趋势；一键自托管部署（Coolify 模板/npx 体验）成为分发基准；OpenClaw 不到 5 个月成为 GitHub 星标最多的仓库（346k+ stars，openclaw.ai 直接抓取核实），本仓已天然对接其会话目录与调试探测。

---

## 3. 方案

> 约定：每条建议含「动机 / 做法 / 验收标准 / 优先级」。编号 A=架构与代码质量，B=上游与 Runtime，C=RustFS 迁移专项，D=开发者体验与吸引力。人日均为粗估（基于调研事实的工程判断，非测量值）。

### 3.1 主题一：架构与代码质量

#### A1 修复 setup/backends 测试的 mock 失效 —— 优先级 P0

- **动机**：这是当前测试套件唯一可稳定复现的失败源（10 个用例，Windows 上隔离单跑仍稳定失败，见 2.1）。它让「测试全绿」信号失真，直接阻塞 A2/A3/A9 所有依赖回归网的改动。
- **做法**：把 `probeBackend` 改为可注入点——推荐在 `src/lib/backend-config.ts` 为 `refreshEffective`（`:748`）增加 seam：`refreshEffective(names, timeoutMs, probeFn = probeBackend)` 或导出内部 `probeOnce` 供测试替换；测试改为 mock seam 而非整个模块（现状 `route.test.ts:24` 的 `vi.mock('@/lib/backend-config')` 拦不到 `:759` 处模块内部绑定调用）。同时让用例显式传入小 timeoutMs，把「探测超时」与「vitest 用例超时」解耦。
- **验收标准**：`npm test` 全量 0 失败；Windows 本机与 Linux CI 各连续 2 次全量运行结果一致；`src/app/api/agentteams/setup/backends/route.test.ts` 隔离单跑稳定通过且总时长 <5s。
- **规模**：1-1.5 人日。

#### A2 生产依赖漏洞非破坏性清理 —— 优先级 P0

- **动机**：13 个生产依赖漏洞（8 高 5 中，已经官方 registry 复测复现，advisory 清单见做法），adm-zip 处于插件 zip 解包安全敏感路径（`src/lib/plugins/server-package.ts`）；sharp override 下限（`package.json:91` `>=0.35.0`）已低于修复版；前四项均可非破坏修复（见 2.1）。
- **做法**：**开工前置**——以官方 registry 重跑 `npm audit --omit=dev` 并把 advisory ID 固化到工作单，以当次输出为准（已复现：`npm audit --omit=dev --registry=https://registry.npmjs.org` → 13 vulnerabilities (5 moderate, 8 high)）。注意：nanoid 的 high 为 2026 新公告 GHSA-2v37-7h3g-55p8（custom generators can loop indefinitely when size is zero），与修复于 3.3.8 的 CVE-2024-13918 不是同一问题。逐条：
  1. adm-zip 升出 ≤0.6.0 漏洞区间 → 最新 **0.6.1**（`npm view adm-zip version --registry=https://registry.npmjs.org` 复核；GHSA-vwc7-r8mq-g2x9 任意文件覆盖、GHSA-7q85-xj36-vmfc DoS），核对插件 zip 解包兼容性；
  2. `package.json` overrides 的 sharp 下限 `>=0.35.0` → `>=0.35.4`（libheif 漏洞 GHSA-rgj7-g3m4-5g8c）；
  3. nanoid 升 `>=3.3.18`（v3 线有 3.3.18/3.3.19，`npm view nanoid@3 version` 复核；对应 GHSA-2v37-7h3g-55p8）；
  4. overrides 增加 `lodash-es >= 4.18`（顶层已是 4.18.1，强制 dedupe mermaid→chevrotain 链上的嵌套旧拷贝；GHSA-r5fr-rjxr-66jc 代码注入、GHSA-f23m-r3pf-42rh 原型污染）；
  5. minio→stream-json（GHSA-528h-pc64-c93x）与 decode-uri-component（GHSA-vcc3-ghjq-m6fr）moderate 链单独评估 override 或等上游，**不采纳 audit 建议的 minio@7.1.3 降级**（破坏性，且与 C 主题的 RustFS 迁移方向冲突）；
  6. 当次 audit 输出中的其余链条（如 baseline-browser-mapping GHSA-w5vr-8v7q-w6rv、chevrotain 链）并入统一处置或记录豁免。
- **验收标准**：`npm audit --omit=dev`（官方 registry）高危清零（如仍余 minio 链 moderate，在 SECURITY/CHANGELOG 记录豁免理由与 advisory ID）；typecheck/lint/test 三门通过；插件上传与技能中心上传（zip 解包路径）手动冒烟通过。
- **规模**：1-2 人日。

#### A3 Node 20→22 LTS 迁移 —— 优先级 P0

- **动机**：Node 20 于 2026-03-24 EOL（来源：nodejs.org/en/about/previous-releases，联网核实），生产镜像运行在无安全补丁的 Node 线（`Dockerfile:13,44`、`ci.yml:24`）；commit 7f21a0a 的 isomorphic-dompurify 降级即漂移成本的实证。
- **做法**：`Dockerfile:13` 与 `:44` 两处 `FROM node:20-alpine` 改 `node:22-alpine`；`ci.yml:24` node-version 改 22；回滚 7f21a0a 的 isomorphic-dompurify 降级（升回 4.x）；核对 README/文档中的 Node 版本要求描述；全量三门 + `build.yml` 多架构镜像构建验证。
- **验收标准**：CI 三流水线绿；多架构（amd64/arm64）镜像构建成功；镜像内 `node -v` ≥ 22；isomorphic-dompurify 恢复 4.x 且测试全绿。
- **规模**：0.5-1 人日（含验证）。

#### A4 README/文档保鲜专项 + CI 防漂移 —— 优先级 P1

- **动机**：6 处过期与死链已逐项确认（见 2.1），直接影响外部用户与贡献者第一印象；无机制防再漂移。
- **做法**：① 修正测试规模描述（改为不含具体数字的表述，如「2000+ tests」，或建立发布前刷新脚本）；② 删除 `README.md:233` 幽灵 `DATABASE_URL` 行；③ 更正 PowerShell 状态为已支持；④ 同步安装器默认版本描述与 `install/agentteams-install.sh:2486` 一致；⑤ 统一主题编辑器参数描述；⑥ 修复 `README.md:331` 死链（更新指向或删除）。⑦ 在 ci.yml 增加文档一致性 job：断言 README 不再包含已知过期字串（724 tests / DATABASE_URL / PowerShell planned）、docs 与 README 内部相对链接存在性检查。
- **验收标准**：6 处修正全部落地；文档一致性 job 进 ci.yml 且绿；故意提交一个死链能让 CI 变红（演练一次）。
- **规模**：1-1.5 人日。

#### A5 巨型文件拆分 —— 优先级 P1（容量超限可顺延至 P2 前段）

- **动机**：5 个超 1000 行文件（见 2.1 精确行数），影响评审、测试与并行协作；chat 模块已有成熟拆分模式（views/hooks/components 子目录）可复制。
- **做法**：逐文件独立 PR、纯重构不改行为（现有用例 + 快照护航），顺序建议：knowledge-section.tsx（1899）→ ChatRoom.tsx（1129）→ projects-section.tsx（1359）→ wen-tian/index.tsx（1333）→ knowledge-graph3d.tsx（1282，已有 next/dynamic ssr:false 按需 chunk 基础，feat/kb-graph-3d 分支工作已部分并入 main）。
- **验收标准**：每个文件拆分后主体 <800 行（目标值可在排期评审时调整）；typecheck/lint/test 三门绿；对应 section 手动冒烟（知识库/聊天/项目看板/问天/图谱 3D）。
- **规模**：每文件 1-2 人日，共 5-10 人日，可分批跨周进行。

#### A6 lint 与 tsconfig 基线收紧 —— 优先级 P1（容量超限可顺延至 P2 前段）

- **动机**：27 个 lint 警告中 15 个 prefer-const 等可自动修复；`eslint.config.mjs:12,14,26` 关闭的关键规则与 `tsconfig.json:13` `noImplicitAny:false` 削弱类型安全；非测试源码 `: any` 子串匹配 39 处（更严口径 36 处，见 2.1）是恢复规则的前置障碍。
- **做法**：分三步、每步独立可回滚：① `eslint --fix` 清掉可自动修复项（约 13 个），剩余手工；② 逐模块清理 `: any`（小 PR 批次）；③ 恢复 `@typescript-eslint/no-explicit-any` 为 error，评估恢复 react-hooks/set-state-in-effect 与 react-compiler，`noImplicitAny:true`。第 ②③ 步与 A5 拆分协同（拆哪个文件先清哪个）。
- **验收标准**：`npm run lint` 0 警告；`eslint.config.mjs` 中 no-explicit-any 恢复为 error；`noImplicitAny:true` 且 typecheck 绿；每步合并时三门全绿。
- **规模**：合计 3-5 人日（分批）。

#### A7 Windows 开发脚本与依赖同步防脱节 —— 优先级 P1

- **动机**：`package.json:6,8` dev/start 为 Unix-only 语法（抽验确认），Windows 贡献者无法直接运行；node_modules 与 lockfile 脱节曾造成假失败（见 2.1）。
- **做法**：dev 脚本改 `cross-env`（或 node 内建 `process.env` 注入的小包装脚本）去掉 env 前缀；日志 tee 改为 node 脚本封装（或去掉管道、用 CI 侧收集）；start 脚本同理。README 开发准备节明确「首次/拉取后先 `npm ci --no-audit --no-fund --legacy-peer-deps`」。
- **验收标准**：Windows cmd 与 Linux 下 `npm run dev` / `npm run start` 均可直接运行；README 说明就位；新人按 README 可一次跑通三门。
- **规模**：0.5-1 人日。

#### A8 覆盖率范围扩大到安全关键模块 —— 优先级 P1（渐进，容量超限可顺延至 P2 前段）

- **动机**：`vitest.config.ts:31-38` coverage include 目前仅 theme/plugins 的 lib 与组件 + `src/lib/section-store.ts`（复测确认）；rbac-engine、audit-log、minio-client、skill-center-storage、homeserver-allowlist 等安全关键纯逻辑无覆盖率数据。
- **做法**：渐进把上述模块加入 coverage include，先补关键路径单测再纳管（RBAC deny 优先语义、审计轮转、bucket 前缀与敏感文件判断等）；阈值逐步抬升，避免一次性拖慢全量。
- **验收标准**：coverage 报告包含上述模块；新增单测全绿；记录接入前后全量测试耗时（增幅可接受，<10%）。
- **规模**：2-4 人日（分批）。

#### A9 依赖大版本升级批次 —— 优先级 P2

- **动机**：npm outdated 实测（基于 npmmirror registry，Latest 列可能有分钟级延迟，各「最新版」发布状态未逐一联网核实）：eslint 9→10、typescript 5.9.3→7.0.2、vitest 4.1.10→5.0.2、uuid 11→14、lucide-react 0.525→1.48、recharts 锁 3.8.1→3.10.1（`package.json:54` 精确锁）、@a2ui 0.10→0.11。
- **做法**：独立批次逐项升级，每项一个 PR，以 A1 修复后的 2011 用例全量为回归网；recharts 升级时同步放开精确锁；eslint 10 / TS 7 这类工具链大版本放最后。
- **验收标准**：每项升级后三门全绿 + 关键页面手动冒烟；package.json 无遗留精确锁版本。
- **规模**：每项 0.5-2 人日，合计 5-10 人日。

#### A10 CI Actions 状态核实与失败告警 —— 优先级 P1（小项）

- **动机**：GitHub Actions 当前实际绿红未能核实（gh 无登录态），CI 绿仅是 `CHANGELOG.md:11` 自述；三条流水线是后续所有改动的回归网。
- **做法**：维护者登录核对 main 最近一次 ci/build/install-test 状态并修红；为 main 失败配置通知（邮件/IM webhook）。
- **验收标准**：main 最近一次三流水线全绿；失败通知可收到（演练一次）。
- **规模**：0.5 人日。

### 3.2 主题二：上游对齐与 Runtime 集成

#### B1 跟进上游 PR #1306，合入本地 worker env 编辑实现 —— 优先级 P1

- **动机**：上游 #1306（open，已核实）与本地分支 `codex/worker-config-gateway`（b1c34f8，领先 main 1 提交）同主题同作者；不主动对齐会两套实现漂移，且该能力（Worker 环境编辑 + 网关身份探测）是用户直接可感的功能。
- **做法**：跟踪 #1306 落定；落定时 diff 本地实现与上游语义（worker env 字段集、gateway-probe 请求/响应、错误语义），按上游为准调整后合入 main；为 `/api/agentteams/workers/[name]/gateway-probe` 补端到端用例；对照清单留档到 spec。
- **验收标准**：main 含与上游 #1306 语义一致的 env 编辑 + 网关探测能力；无字段漂移（对照清单存档）；三门全绿。
- **规模**：1-2 人日（视上游落定时间）。

#### B2 Runtime 展示与门控内部一致性收尾 —— 优先级 P1（零上游依赖，可立即做）

- **动机**：deepseek-harness 已可创建（`agentteams-api.ts:12`）但 `runtime-section.tsx` 无卡片、计数只统计 5 种（`:16-60`、`:80`）；KB/workspace 面选非 QwenPaw runtime 时 404 降级且无提示（`docs/code-review-issues.md:164`）；QwenPaw 卡片模型宣传过时；DeepSeek Harness 上游标注实验性且端到端未验证（v1.2.4 release notes，已核实）。
- **做法**：① 补 deepseek-harness 卡片与计数；② KB/workspace-files 的 Worker 下拉按 runtime 过滤，或在 UI 明示「QwenPaw 专属」及原因；③ 以 `.monkeycode/specs/worker-card-v2-chat-runtime-ux/task-book.md` §4.1 能力对照表为底稿沉淀正式 runtime 能力表（docs/ 下新文档或 runtime-section 内嵌），替换卡片里过时的 models 宣传；④ dsh 卡片加「实验」徽标。
- **验收标准**：runtime-section 卡片数与可创建 runtime 数一致（4 可建 + legacy 展示口径明确）；选非 qwenpaw runtime 时 KB 面给出明确禁用原因；能力表评审合入。
- **规模**：1-2 人日。

#### B3 上游对齐自动化：install.sh 漂移检测 + Controller 契约对照 —— 优先级 P1

- **动机**：`install/agentteams-install.sh`（4707 行上游安装器工作副本，`:2486` 内嵌 Dashboard 版本）与上游 main 的漂移无自动检测；Controller 源码仓库不可公开访问（api.github.com 404，已核实），契约只存在于 `docs/INTERFACES.md` 与上游 release notes——上游每次 minor（如 v1.2.4 的 events 分页、审计字段）都需对照校验 `/api/v1/*` 变更，目前靠人肉。
- **做法**：① CI 增加 weekly cron job：拉取上游安装器与本仓副本 diff，超阈值（如 >50 行或命中 step_dashboard 段）时开 issue 告警；② 在 `docs/INTERFACES.md` 建立「上游版本对照记录」小节，形成流程：上游 minor 发布后过一遍 proxy 层端点（`src/app/api/agentteams` 112 个 route 的目标端点清单），确认无降级横幅式故障。
- **验收标准**：cron job 上线且首次运行产出 diff 报告；INTERFACES.md 含 v1.2.4 对照记录；流程写入 CONTRIBUTING（与 D1 协同）。
- **规模**：1-1.5 人日。

#### B4 org.agentteams.run v1 协议固化 —— 优先级 P1

- **动机**：Dashboard 已备好 v1 解析路径（`docs/ARCHITECTURE.md:125-133`、`src/lib/a2ui/protocol.ts`），未知版本降级 13 级文本启发式；协议约定若不先固化，上游 runtime 实现与本仓解析会漂移，错失「结构化块替代文本启发式」的窗口。生态趋势（Codex app-server JSON-RPC、ACP）表明结构化会话协议是方向，org.agentteams.run 是本项目的对接口。
- **做法**：把 v1 块协议（块类型 union：text/thinking/tool_call/confirmation/error、字段规范、版本协商、未知版本回退语义）写入 `docs/INTERFACES.md` 新章节；向上游提 PR/issue 对齐；保持 normalize.ts 既有启发式为兜底（`README.md:56` 已声明 run 块是兼容格式而非唯一协议，方向一致）。
- **验收标准**：INTERFACES.md 含协议章节；上游侧获得确认（issue/PR 有回应）；协议解析测试覆盖未知版本回退路径。
- **规模**：1-2 人日。

#### B5 QwenPaw 迁移收口与上游兼容窗口对齐 —— 优先级 P1（时点依赖上游发版）

- **动机**：本仓已停止新建 CoPaw（`CHANGELOG.md:4-7`；`runtime-options.ts:18` 创建被拒并提示迁移）；上游 #1303（copaw worker 1.0.4 兼容包，已核实）定义了存量兼容窗口；`agentteams-api.ts:12` 的 `WorkerRuntime` 仍含 `'copaw'`（存量只读语义，应保留至清理时点）。
- **做法**：与上游约定存量 CoPaw 清理时点（建议跟上游下一个 minor 走）；明确「升级态」实例迁移引导（备份提示已有，见 COPAW_MIGRATION_HINT 文案）；梳理 `.copaw` 会话目录回退探测（debug-log 既有 qwenpaw 优先 + copaw 回退）的退役计划。
- **验收标准**：CHANGELOG/文档明确清理时点；存量 CoPaw 实例「一键升级 QwenPaw」路径冒烟通过；退役计划成文。
- **规模**：0.5-1 人日（本体），等待上游窗口。

#### B6 外部 coding agent runtime 接入评估（Claude Code / Codex CLI / opencode）—— 优先级 P2

- **动机**：生态正从文本启发式走向结构化会话协议（见 2.2）；Claude Code 用户基数最大、Agent SDK 为 TypeScript 与本仓同构、审批语义可直接映射到现成 confirmation 块/HITL inbox（`src/lib/hitl-inbox.ts`）；`codex app-server` 的 JSON-RPC 2.0 事件（session/tool_call/approval/diff）与 org.agentteams.run v1 语义几乎一一对应，是「结构化协议→Dashboard 渲染」转换成本最低的样板；opencode `serve` 适合作为外部 HTTP agent 接入的通用模板。Gemini CLI 优先级最低（headless 下 MCP/prompt 扩展有已知缺口，来源转述）。
- **做法**：先做评估 spike、不做实现承诺：① 明确接入面为「结构化协议→org.agentteams.run 块」的协议适配器，而非再加一套 Matrix 文本启发式；② 拆解工作量归属——主要在上游（Controller CRD 枚举、agentconfig generator、Matrix channel 插件），Dashboard 侧为枚举扩展 + runtime-meta/runtime-options + 能力门控 + 会话收集（`src/app/api/agentteams/debug-log/sessions.ts` 的 per-runtime 收集器模式可复用），需与上游维护者对齐排期；③ 轻量替代路径先行：以「外部 agent 输出经 A2UI 标记投递进 Matrix」验证需求（openclaw 现行模式），绕过 Controller 改动；④ 计费合规评估显式纳入：Claude Agent SDK 与 `claude -p` 编程化用量自 2026-06-15 起按独立积分计费（来源：搜索摘要转述，未深度核实，立项前必须核实官方文档）。
- **验收标准**：产出评估报告（上游工作量拆解 + 计费合规 + 推荐排序）；若立项，至少一个 runtime 端到端 demo（创建→会话→审批→调试日志）。
- **规模**：评估 2-3 人日；单个 runtime 落地为独立立项。

#### B7 MCP 能力深化 —— 优先级 P2

- **动机**：现仅支持远程 sse/streaminghttp transport + 三种网关代理（`src/components/dashboard/sections/mcps/mcp-server-dialog.tsx:26-45`），缺 stdio 本地 MCP 托管（Claude Code/Codex 均以 stdio 为一等公民）与远程 MCP OAuth 认证（对标 Gemini CLI）；mcp-catalog 的 per-worker 接线（上游 #1250，`src/app/api/agentteams/mcp-catalog/route.ts`）未与 Worker 创建流程打通。
- **做法**：① Worker 创建对话框按 mcp-catalog 默认勾选接线（低成本先行）；② stdio MCP 托管需 Controller 侧支持，产出需求/设计稿与上游对齐；③ 远程 MCP OAuth 需求登记；④ 与 D4 的 README MCP 故事联动。
- **验收标准**：① 落地且有用例；②③ 产出设计稿/需求单并有上游回应；④ 见 D4。
- **规模**：① 1 人日；②③ 设计 1-2 人日。

#### B8 知识库/审计数据面切 Controller 正源评估 —— 优先级 P2

- **动机**：上游 v1.2.4 提供 L2 权限/审计扩展与团队知识库目录（release notes 已核实）；本仓已有 enforceServerSideRbac + 审计 JSONL（`docs/ARCHITECTURE.md:121-123`）与 KB 图谱（feat/kb-graph-3d），数据面可切 Controller 正源并复用上游任务 history[] 与 events 分页；`docs/项目.md:163` 已有 Controller 降级时看板 fallback 到 MinIO 直读的语义，正源化后降级路径仍保留。
- **做法**：对照上游 v1.2.4 契约评估切换范围（KB 目录、审计字段）与收益；产出「切/不切 + 理由」结论；若切，给灰度方案与回滚点（保留 MinIO/本地读取路径一个版本周期）。
- **验收标准**：评估结论进入本方案后续修订；若立项则灰度与回滚方案明确。
- **规模**：评估 1-2 人日。

### 3.3 主题三：对象存储 MinIO→RustFS 迁移专项

#### 3.3.0 背景与范围限定（如实说明）

- **动机（已核实）**：MinIO 社区版已在 GitHub 归档、source-only（2025-10-15 起）——即使今天不动，也拉不到任何新补丁镜像；这是安全硬伤而非许可洁癖。RustFS 1.0 GA、S3 兼容面覆盖本项目全部 11 个 SDK 方法、健康端点与 env 变量均有 MinIO 兼容层（证据见 2.3）。
- **范围限定**：真正替换 MinIO 二进制的动作发生在 **agentteams-controller 仓库**（MinIO 内嵌于 controller 容器，9000 端口）；本仓库（dashboard）是纯 S3 客户端，调用收敛在 `src/lib/minio-client.ts`。**dashboard 运行面零代码改动的前提有二**：① bucket 名/前缀不变；② controller 容器继续导出安装器可识别的凭证变量（`AGENTTEAMS_FS_*` 或 `AGENTTEAMS_MINIO_*` 别名）——若 controller 切换后把导出变量更名为 `RUSTFS_*`，dashboard 全新安装的凭证探测将落空且**静默失效**（BUCKET/ACCESS_KEY/SECRET_KEY 无兜底值、仅 warn 后继续，`install/agentteams-dashboard.sh:326-342,392-394`；空凭证不注入容器，运行时存储面不可用，见 3.3.1-3b），此时需给 `install/agentteams-dashboard.sh` 增加 RUSTFS_* 回退（小改动，已入列 3.3.5 条件项）。迁移决策与执行需 controller 仓库配合；因未接触 controller 源码，其内部是否使用 `mc admin` 等管理 API **未核实**，controller 侧工作量为估计值。
- 本专项给维护者的产出：兼容性核对清单（可直接移交 controller 团队）、分步迁移方案、风险与缓解、本仓库侧必须完成的回归工作。

#### 3.3.1 迁移前提与兼容性核对清单

| # | 核对项 | 本项目现状（证据） | RustFS 支持（来源） | 结论 |
|---|---|---|---|---|
| 1 | SDK 方法面 | 11 个方法：listBuckets/bucketExists/makeBucket/listObjects/getObject/putObject/statObject/removeObject/removeObjects/presignedGetObject/presignedPutObject（方法集与计数经复测，见 2.3，共 73 处调用）；未用 policy/versioning/SSE-KMS/copyObject/multipart | 官方文档核实全部支持（docs.rustfs.com/en/administration/protocols/s3，WebFetch 核实） | ✅ 零改动 |
| 2 | 健康探测路径 | `src/lib/backend-config.ts:486` `minio: { path: '/minio/health/live' }`；`install/agentteams-install.sh:4055` 安装健康检查同路径 | `/minio/health/live` 与 `/minio/health/ready` 为 MinIO 兼容别名，默认启用（docs.rustfs.com/en/operations/status-check） | ✅ 零改动 |
| 3a | controller 容器内 RustFS **服务端** env 映射 | 本仓不可见、不可核实：两份 install 脚本均不设置 MINIO_ROOT_USER/MINIO_ACCESS_KEY/MINIO_VOLUMES 等服务端变量（grep 零命中，复测确认）；RustFS 服务进程 env 由 controller 侧配置 | `MINIO_ACCESS_KEY/SECRET_KEY/ROOT_USER/ROOT_PASSWORD/ADDRESS/VOLUMES/REGION` 白名单自动映射 `RUSTFS_*`，默认启用（docs.rustfs.com/en/reference/environment-variables）；controller 侧沿用 MINIO_* 或直接写 RUSTFS_* 均可 | ⚠️ 移交 controller：服务端 env 映射与 ADDRESS/VOLUMES 由其负责；**与 dashboard 客户端无关**（注意：不可用此项推出 dashboard 零改动结论） |
| 3b | dashboard **安装器凭证探测 allowlist**（全新安装链路） | `install/agentteams-dashboard.sh:326-342` 仅认 `AGENTTEAMS_FS_*` → 回退 `AGENTTEAMS_MINIO_BUCKET/USER/PASSWORD/ENDPOINT`；BUCKET/ACCESS_KEY/SECRET_KEY 无 else 兜底（仅 endpoint 有默认 `http://{controller}:9000`），探测落空仅 warn 后继续（`:392-394`）、空凭证不注入容器（`:448-449`）→ 存储面静默失效（通读核实） | 与 RustFS 的 MINIO_*→RUSTFS_* 白名单**无交集**：该白名单只作用于 RustFS 服务进程 env，不改变 controller 容器导出给安装器读的变量名 | ⚠️ 条件项：controller 须承诺切换后继续导出 `AGENTTEAMS_FS_*`（或 `AGENTTEAMS_MINIO_*`）别名；否则 `install/agentteams-dashboard.sh` 增加 RUSTFS_* 回退（0.5 人日，入列 3.3.5/4.1）；阶段 0 用 RustFS 版 controller 跑一次全新安装验证（3.3.4 第 9 项） |
| 4 | 预签名 URL | presign GET/PUT，15 分钟过期（`storage/presign/route.ts:5`），敏感文件拒签统一 404 | presigned GET/PUT（SigV4）支持 | ⚠️ 需回归（切签发方向） |
| 5 | 错误码语义 | 参数 400 / bucket 已存在 409 / 不存在 404（`docs/模块/服务端API.md:34`） | 官方定位 drop-in；已知差距：XML grant policy 返回 NotImplemented、canned ACL 部分兼容、multipart 列举边缘 case、POST form 上传 checksum 不完整 | ⚠️ 需对 storage/skills 路由做错误码回归（本项目调用面不涉 ACL/grant policy，预期通过） |
| 6 | bucket 与前缀约定 | 双 bucket：AGENTTEAMS_FS_BUCKET（agentteams-data / agentteams-storage，`install/agentteams-install.sh:3949-3952`）+ skills 硬编码（`skill-center-types.ts:57`）；前缀 mcp-servers/、shared/tasks\|projects/、agents/、teams/、skills/ | bucket 名/前缀为 S3 通用概念 | ✅ 保持不变即 dashboard 零改动 |
| 7 | 高级特性 | 未用 versioning/加密/对象锁（全仓 grep 无） | mc mirror/rclone 迁移不保留版本历史 | ✅ 无影响（记录豁免） |
| 8 | 客户端 SDK | minio npm SDK ^8.0.7（`package.json:45`）是 SigV4 S3 客户端，不限服务端品牌 | — | ✅ 不更换（可选换 aws-sdk v3 去品牌依赖，非必须，不建议本期做） |

**迁移门槛（前提）**：第 4、5 项回归全绿 + 第 3b 项条件落实（controller 别名承诺，或 dashboard.sh RUSTFS_* 回退已实施）+ 阶段 0 验证通过（见下），方可排产切换；RustFS 版本锁定当时最新 stable（1.0.x GA 线），不追 preview。

#### 3.3.2 分步迁移方案

- **阶段 0：测试环境验证（前置门槛）**。在 controller 测试环境以相同端口约定（9000 S3 + 9001 console）部署 RustFS，挂新数据目录；服务端 env 按 3.3.1-3a 由 controller 侧映射；执行 3.3.4 的回归清单（64MB 技能 ZIP 上传、presign 链路、storage/skills 错误码、并发 listObjects 全量遍历）；**用 RustFS 版 controller 跑一次 `install/agentteams-dashboard.sh` 全新安装，验证安装器凭证自动探测（3.3.1-3b 回退链）仍成立**——若 controller 已把导出变量更名为 RUSTFS_* 且未保留别名，此步必然失败，先执行 3.3.5 条件项（dashboard.sh RUSTFS_* 回退）再重跑；容器加内存上限并监控（针对 object cache 内存 issue）。**门槛：回归清单全绿 + 安装器探测验证通过，才进阶段 1。**
- **阶段 1：数据迁移**。`mc alias` 分别指向旧 MinIO 与新 RustFS → `mc mirror --dry-run` 预演差异 → `mc mirror` 全量 → 低峰增量追平（或改用 rclone copy，并行/限速/校验能力更好）。**禁止磁盘级直接复制数据目录**（MinIO 数据格式兼容仅 Preview 且默认构建不含，MinIO 加密对象在 RustFS 不可读）；版本历史不保留（本项目未用 versioning，无影响）。
- **阶段 2：切换**。低峰窗口。**写入口处置（如实说明）**：dashboard 管理面写入口（技能 ZIP 上传、storage 上传、MCP 配置）可软冻结（提前公告暂停操作）；但 controller/Worker 侧任务产物写入**无本仓可见的冻结手段**（是否存在 quiesce/停 Worker 等机制未核实），故整体按「**低峰窗口 + 最终增量 mirror 追平 + 接受小时间窗一致性**」口径执行，并把「有无写入冻结手段及其代价」列入移交 controller 的核对问题——**不承诺零数据差**。→ 最终增量 mirror → 校验（对象数、总大小、抽样 GET 比对）→ controller 侧把 FS 服务端点切到 RustFS（同 9000 端口则 dashboard 端点无需变更；若端点变化，两条改法**生效语义不同**：F1 配置文件=**热生效**——`readConfigSync` 每次调用均从磁盘重读（`backend-config.ts:198-204`），`getMinioConfigFromEnv` 先取 `pickBackendUrl('minio')`（`minio-client.ts:46-52`），复测确认；`AGENTTEAMS_FS_ENDPOINT` 为进程 env=**需重启 dashboard 容器**——运行手册必须写明二者差别，不承诺 env 路径零停机）→ 观察技能上传、任务产物、MCP 配置、团队/Worker 文件读写。
- **阶段 3：观察期（≥1 周）**。原 MinIO 数据目录保留只读作回滚点；监控 RustFS 内存（cache）与 5xx 错误率；dashboard 健康面板（`backend-config.ts:486` 探测）应全程绿。
- **阶段 4：回滚（预案，非必经）**。dashboard 端点回滚两条路径**生效语义不同**：F1 配置文件改回=热生效（`backend-config.ts:198-204` 每次读盘）；改 `AGENTTEAMS_FS_ENDPOINT` env=需重启 dashboard 容器——回滚预案默认走 F1 文件路径以最小化停机，运行手册写明差别。数据回滚 = 切回原 MinIO 数据目录。注意：观察期内新写入对象只存在于 RustFS，切回前需反向 mirror 或明确接受丢失窗口（与阶段 2 的小时间窗一致性口径一致，不承诺零数据差）——回滚演练时必须演练这一步。清理期结束后归档删除旧目录。

#### 3.3.3 风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| 1 | RustFS 1.0 GA 年轻（约 2026-09 GA，生产案例积累中） | 阶段 0 门槛 + ≥1 周观察期 + 只读回滚点；备选：暂用已有镜像（风险自担）/ Ceph / Garage / SeaweedFS |
| 2 | object cache 内存占用 issue（2026-04 报告，未息；来源为检索摘要，未读原文） | 容器内存上限 + 阶段 0/3 持续监控；升级到含修复的版本再切 |
| 3 | 磁盘级数据不兼容（仅 Preview、加密对象不可读） | 强制走 S3 API 迁移（mc mirror/rclone），禁止直接拷贝数据目录，写入操作手册 |
| 4 | 迁移不保留对象版本历史 | 本项目未用 versioning，无影响；核对清单第 7 项留档 |
| 5 | 池拓扑 parity 自动选择与 MinIO 默认值有差异 | 内嵌单机场景影响小；部署时显式指定 parity，不做隐式默认 |
| 6 | 错误码/边缘 case 差异（multipart 列举、POST form checksum、canned ACL） | 错误码回归覆盖本项目实际调用面（不含 ACL/grant policy）；发现差异先在测试环境定位 |
| 7 | 跨仓库协作（执行在 controller 仓） | 本清单与回归脚本直接移交 controller 团队；迁移里程碑与 controller 发版窗口对齐；C2 两项书面确认（别名导出、冻结手段） |
| 8 | controller 切换后不保留 AGENTTEAMS_FS_*/AGENTTEAMS_MINIO_* 导出别名 → dashboard 全新安装存储面静默失效 | 3.3.1-3b 条件项：controller 书面承诺保留别名；否则 dashboard.sh 增加 RUSTFS_* 回退（0.5 人日）；阶段 0 安装器冒烟兜底验证 |
| 9 | 与 CHANGELOG Unreleased（CoPaw→QwenPaw）发版窗口冲突 | 排期协调，见第 5 节风险 1 |

#### 3.3.4 验证与回归清单（阶段 0 必跑）

1. 64MB 技能 ZIP 上传（上限用例，`docs/模块/技能中心.md:84`：超限返回 400）；
2. presign 链路：GET/PUT 签发 + 15 分钟过期 + 敏感文件拒签 404（`storage/presign/route.ts`）；
3. storage 管理面错误码回归：buckets/[bucket] CRUD、objects 列表+CRUD、bulk-delete、stats、download/upload（`src/app/api/agentteams/storage/` 全树，实测共 9 个 route + 1 个测试）；
4. skills 三来源（custom/nacos/builtin）列表、上传、下载、Nacos 缓存下载；
5. team-tasks / teams files / workers files 读写（shared/tasks、shared/projects、agents、teams 前缀）；
6. 并发 listObjects（skills 全量遍历元数据前缀，`src/lib/skill-center-storage.ts`）；
7. dashboard 健康面板对 minio 后端探测显示正常（`backend-config.ts:486`）；
8. MCP 配置（mcp-servers/ 前缀）CRUD；
9. **用 RustFS 版 controller 跑一次 `install/agentteams-dashboard.sh` 全新安装**：验证凭证自动探测（3.3.1-3b 回退链）与端点 127.0.0.1→controller 主机名改写仍正确，dashboard 存储面可用（不出现「静默无凭证」）。

#### 3.3.5 工作量估算（人日级，粗估）

| 工作项 | 归属 | 估算 |
|---|---|---|
| 兼容性核对清单落档 + 3.3.4 回归脚本/用例编写与执行 | dashboard | 1.5-2 人日 |
| 测试环境 RustFS 部署与验证（阶段 0，含回归执行、内存监控、安装器全新安装冒烟） | controller + dashboard 联合 | 2-3 人日 |
| 生产数据迁移与切换执行（阶段 1-2，低峰窗口） | controller | 1-2 人日 |
| 观察期值守 + 回滚预案演练（含反向 mirror 步骤） | controller 为主 | 0.5-1 人日 |
| 文档更新（部署文档 / INTERFACES / CHANGELOG / README env 说明） | dashboard | 0.5 人日 |
| dashboard.sh 增加 RUSTFS_* 凭证回退（**条件项**：仅当 controller 切换后不保留 AGENTTEAMS_FS_*/AGENTTEAMS_MINIO_* 导出别名，见 3.3.1-3b） | dashboard | 0.5 人日（条件触发） |
| **合计（基础）** | | **约 5.5-8.5 人日**（dashboard 直接承担约 2-2.5 人日）+ 最多 0.5 人日条件项 |

> 未核实项：controller 侧估算未接触其源码（是否使用 mc admin 管理 API 未知）；阶段 2 的写入冻结手段是否存在未核实；若 controller 内部有管理面对 RustFS 无等价能力，需追加评估。以上均已列入 C2 移交确认清单。

#### C1 错误码与链路回归套件 —— 优先级 P1

本专项在本仓库侧需完成以下两项行动条目（编号入第 4 节总表）。

- **动机**：迁移门槛的两项「⚠️ 需回归」（presign、错误码）落在本仓库；RustFS 官方定位 drop-in 但已知差距存在，需要以本项目实际调用面为口径的回归证明；3.3.1-3b 的安装器链路也只能靠冒烟验证。
- **做法**：按 3.3.4 清单编写可重复执行的回归（vitest 集成测试 + 手动冒烟脚本），对 MinIO（现状）先跑通作为基线，迁移后对 RustFS 重跑比对；清单含安装器全新安装冒烟（第 9 项）；若 controller 不保留 `AGENTTEAMS_FS_*`/`AGENTTEAMS_MINIO_*` 导出别名（3.3.1-3b 条件项），实施 `install/agentteams-dashboard.sh` 的 RUSTFS_* 凭证回退并回归。
- **验收标准**：回归套件在现网 MinIO 上全绿；套件与清单文档化并可移交 controller 团队；条件项若触发，RUSTFS_* 回退经全新安装冒烟验证。
- **规模**：1.5-2 人日（条件项另 +0.5 人日）。

#### C2 迁移决策推动与清单移交 —— 优先级 P1（决策项）

- **动机**：迁移动机成立且较强（归档无安全补丁是硬伤，见 3.3.0），但执行权在 controller 仓库；不推动则风险持续累积且无补丁镜像可拉。
- **做法**：向 controller 维护者提交本专项（核对清单 + 分步方案 + 估算）；约定阶段 0 时间窗；**书面确认两项**：① 切换后继续导出 `AGENTTEAMS_FS_*`（或 `AGENTTEAMS_MINIO_*`）变量供安装器探测（否则触发 dashboard.sh RUSTFS_* 回退条件项）；② 是否存在任务产物写入的冻结手段（quiesce/停 Worker）及其代价，用于确认阶段 2 口径；同步登记到本仓 CHANGELOG/风险表。
- **验收标准**：controller 侧给出明确接受/拒绝/延后结论；两项书面确认（别名导出、冻结手段）留档；若接受，阶段 0 排期落定。
- **规模**：0.5 人日 + 会议沟通。

### 3.4 主题四：开发者体验与吸引力

#### D1 贡献者入口基线 —— 优先级 P1

- **动机**：缺 CONTRIBUTING.md 与 issue/PR 模板（核实见 2.4）；开源增长研究表明 README/CONTRIBUTING 是贡献者第一触点、文档是非代码贡献常见入口（来源：ACM/IEEE Software 研究，转述）；插件系统与脚手架（`README.md:62-72`）是现成低门槛入口但缺引导；`README.md:331` 死链直接影响专业感。
- **做法**：① 新增贡献者指南（CONTRIBUTING.md，**规划新建**）：三门验证顺序（typecheck→eslint→vitest，沿用 `.monkeycode/MEMORY.md` 沉淀的验证顺序）、`npm ci` 同步约定、AI 协作痕迹约定（`lint:tone` 门禁）、上游对齐流程（引用 `install/AGENTTEAMS_PATCH.md`）；② 补 issue（bug/feature）与 PR 模板；③ 修复 `README.md:331` 死链；④ 插件 gallery 页（内置 wen-tian/monitor-panel 之外给外部插件曝光位）。
- **验收标准**：CONTRIBUTING/模板合入；A4 的死链检查覆盖新文档；gallery MVP 可浏览已注册插件。
- **规模**：2-3 人日。

#### D2 「Mission Control」定位与 README 改版 —— 优先级 P1

- **动机**：agent teams 模式 2026 年成为主流但框架普遍缺运维台；本仓独有的 Worker 生命周期、拓扑视图、项目 DAG/loop 干预与干预记录审计（`docs/项目.md:91-154`）正好补位；一张「agent 办公室驾驶舱」截图/GIF 是最强可传播资产。
- **做法**：README（中英双语）首屏配大图/GIF（overview 拓扑 + 任务看板干预 + Chat 回放三连）；定位文案从「管理面板」升级为「多智能体团队 Mission Control」；同步社区发布渠道。
- **验收标准**：双语 README 首屏含演示图与定位语；一次对外发布（release notes/社区帖）使用该定位。
- **规模**：1-2 人日（录制/截图另计）。

#### D3 会话回放/可观测性卖点 —— 优先级 P2

- **动机**：自托管用户不愿另接 Langfuse 类工具；行业趋势是 session replay + tracing 深度（转述）；本仓渲染与调试日志基础已具备（`README.md:38,56`）。
- **做法**：支持把一场 agent 会话导出为可分享只读回放链接（默认脱敏，复用 debug-log 的 PII 脱敏语义）；README 用 GIF 演示 thinking/tool-call/工作流卡片折叠回放；文案借 trace/span 词汇降低理解成本。
- **验收标准**：MVP 导出链接可用且默认脱敏（安全评审：链接访问控制明确）；README 演示段上线。
- **规模**：3-5 人日（含脱敏与访问控制设计）。

#### D4 MCP 治理中心故事 —— 优先级 P2（与 B7 联动）

- **动机**：MCP 治理/安全是 2026 企业侧头号痛点（转述）；本仓已具备注册表 CRUD、mcp-catalog per-worker 接线、Higress per-consumer 授权与审计，但 README 功能表未讲 MCP 故事（当前仅 `docs/INTERFACES.md` 提及）。
- **做法**：README 增「MCP 治理」章节（registry、per-consumer 授权、审计线索）；做技能/MCP 目录一键安装到 Worker 的演示 GIF。
- **验收标准**：README MCP 章节与演示上线；B7① 的默认接线作为演示素材。
- **规模**：0.5-1 人日（文案/演示，不含 B7 开发）。

#### D5 一键部署可传播 —— 优先级 P2

- **动机**：一键部署基准已抬到 Coolify 模板/npx 体验（转述）；本仓 docker run 一行 + setup 向导 + 上游安装器集成已达标（`README.md:151-156`，PR #1075），差「可传播」一层。
- **做法**：发布 docker compose 模板与 Coolify 模板；评估只读在线 demo 站——**安全前提**：只读沙箱账号 + 独立后端 + 不暴露真实集群（`README.md:168` 的 DASHBOARD_SESSION_SECRET 等安全默认需保持）；README 嵌 30 秒安装到看到 agent 团队的 GIF。
- **验收标准**：compose/Coolify 模板可一键起；demo 站通过安全评审后发布（评审不过则只发模板，demo 站降级为 GIF）。
- **规模**：2-3 人日（demo 站另计）。

#### D6 OpenClaw/QwenPaw 生态兼容维护原则 —— 优先级 P2（持续项）

- **动机**：OpenClaw 346k+ stars 但迭代极快（2026 年内多次重命名与发布，openclaw.ai 核实）；本仓依赖其会话目录探测（`.qwenpaw` 优先 + `.copaw` 回退，`CHANGELOG.md` Unreleased 已记录），上游变动可能导致 Dashboard 失联。
- **做法**：把「向后兼容探测」固化为原则：runtime 会话目录/端点变更时保持旧路径回退一个版本周期；将 OpenClaw/QwenPaw 发版冒烟纳入 B3 的上游对照流程；探测回退路径补测试。
- **验收标准**：回退路径有测试覆盖；每次上游 runtime 发版后冒烟清单有记录。
- **规模**：0.5 人日 + 持续执行。

---

## 4. 优先级与路线图

### 4.1 优先级总表

| 优先级 | 编号 | 事项 | 主题 | 依赖 | 规模（粗估） |
|---|---|---|---|---|---|
| P0 | A1 | 修复 setup/backends 测试 mock 失效 | 架构 | 无 | 1-1.5 人日 |
| P0 | A2 | 非破坏性依赖漏洞清理 | 架构 | 无（建议在 A1 后合入以获得干净回归网） | 1-2 人日 |
| P0 | A3 | Node 20→22 LTS 迁移 | 架构 | A1（回归网可信） | 0.5-1 人日 |
| P1 | A4 | README/文档保鲜 + CI 防漂移 | 架构 | 无 | 1-1.5 人日 |
| P1 | A5 | 巨型文件拆分（5 文件分批，**可顺延 P2 前段**） | 架构 | A1 | 5-10 人日 |
| P1 | A6 | lint/tsconfig 基线收紧（**可顺延 P2 前段**） | 架构 | 与 A5 协同 | 3-5 人日 |
| P1 | A7 | Windows 开发脚本防脱节 | 架构 | 无 | 0.5-1 人日 |
| P1 | A8 | 覆盖率扩大到安全关键模块（**可顺延 P2 前段**） | 架构 | 无 | 2-4 人日 |
| P1 | A10 | CI Actions 状态核实与告警 | 架构 | 维护者登录态 | 0.5 人日 |
| P1 | B1 | 上游 #1306 对齐合入 | 上游 | 上游 PR 落定 | 1-2 人日 |
| P1 | B2 | Runtime 一致性收尾 | 上游/Runtime | 无（零上游依赖） | 1-2 人日 |
| P1 | B3 | install.sh 漂移检测 + 契约对照 | 上游 | 无 | 1-1.5 人日 |
| P1 | B4 | org.agentteams.run v1 协议固化 | Runtime | 上游确认 | 1-2 人日 |
| P1 | B5 | QwenPaw 迁移收口 | 上游 | 上游 minor 窗口 | 0.5-1 人日 |
| P1 | C1 | RustFS 回归套件（dashboard 侧，含安装器冒烟；条件项 RUSTFS_* 回退另 +0.5） | 存储 | 无 | 1.5-2 人日 |
| P1 | C2 | RustFS 迁移决策推动 | 存储 | controller 团队 | 0.5 人日 |
| P1 | D1 | 贡献者入口基线 | DX | A4（死链检查） | 2-3 人日 |
| P1 | D2 | Mission Control README 改版 | DX | 无 | 1-2 人日 |
| P2 | A9 | 依赖大版本升级批次 | 架构 | A1 | 5-10 人日 |
| P2 | B6 | 外部 runtime 接入评估 | Runtime | 上游意向 | 评估 2-3 人日 |
| P2 | B7 | MCP 深化 | Runtime | 上游（stdio 部分） | 2-3 人日 |
| P2 | B8 | KB/审计数据面切正源评估 | 上游 | 上游 v1.2.5+ | 1-2 人日 |
| P2 | C3* | RustFS 迁移执行（阶段 0-4） | 存储 | C1/C2 + controller | 3.5-6 人日（controller 侧为主，= 3.3.5 阶段 0-4 分项和） |
| P2 | D3 | 会话回放卖点 | DX | A5（ChatRoom 拆分后更易做） | 3-5 人日 |
| P2 | D4 | MCP 治理故事 | DX | B7① | 0.5-1 人日 |
| P2 | D5 | 部署模板与 demo 站 | DX | 安全评审 | 2-3 人日 |
| P2 | D6 | OpenClaw 兼容维护原则 | DX/Runtime | B3 | 0.5 人日 + 持续 |

\* C3 为 3.3.2 阶段 0-4 的执行，前置门槛是 C1 全绿与 C2 决策通过。

> **容量说明**：P1 合计约 21.5-38.5 人日，超过单人 4 周窗口（约 20 个工作日）；故 A5/A6/A8 标注**可顺延至 P2 前段**，P1 阶段出口相应为「主体合入」（见 4.2）。

### 4.2 分阶段路线

| 阶段 | 时间窗 | 重点内容 | 阶段出口 |
|---|---|---|---|
| 第一阶段（P0） | 第 1-2 周 | A1 → A2 → A3 依序落地（A1 优先，为后两者提供可信回归网）；同期完成两件协调事项：① 与维护者确认 CHANGELOG Unreleased（CoPaw→QwenPaw）发版窗口，冻结与其冲突的枚举类变更；② A10 核实 Actions 真实状态 | 三门全绿、audit 高危清零、CI 跑在 Node 22 |
| 第二阶段（P1） | 第 3-6 周 | 并行三线——**质量线**（A4/A7 优先；A5 批次 1/A6 步骤①②/A8 视容量推进，可顺延至 P2 前段，容量见 4.1 说明）、**上游线**（B2→B1→B3→B4，B5 视上游窗口）、**存储与 DX 线**（C1→C2、D1、D2） | P1 主体合入（A5/A6/A8 允许顺延）；RustFS 决策有结论；若决策通过则 C3 阶段 0 排期落定 |
| 第三阶段（P2） | 第 7-12 周 | 顺延项收尾（A5/A6/A8 若第二阶段容量不足）；A9 依赖批次；B6 评估报告与可能的立项；B7/B8；D3-D6；若 C2 通过，C3 迁移执行（测试环境 → 生产窗口） | 本方案全部条目关闭或转为下一轮计划的输入 |

### 4.3 关键依赖链

| # | 依赖关系 | 说明 |
|---|---|---|
| 1 | A1 → A2/A3/A9 | A1 是 A2/A3/A9 的回归网前提（否则 2011 用例的「全绿」不可信） |
| 2 | A3 → isomorphic-dompurify 4.x | A3 解锁 isomorphic-dompurify 4.x（回滚 7f21a0a） |
| 3 | A5（ChatRoom 拆分）→ D3 | 会话回放改造前置于 ChatRoom 拆分 |
| 4 | C1 → C2 → C3 | RustFS 硬链条；C3 的阶段 0 依赖 controller 侧服务端 env 映射（3.3.1-3a）与安装器别名承诺（3.3.1-3b）；C3 执行窗口必须避开 CHANGELOG Unreleased 发版窗口与 controller 发版 |
| 5 | B1/B4/B5 ← 上游节奏 | 时点由上游决定，Dashboard 侧只做「准备 + 对齐」，不做单向先行实现 |

---

## 5. 风险与未决问题

1. **发版窗口冲突**：CHANGELOG Unreleased 的 CoPaw→QwenPaw 停建记录尚未发版（`CHANGELOG.md:4-7`），且 `agentteams-api.ts:12` 的 `WorkerRuntime` 仍含 `'copaw'`。本方案 B2（卡片/计数改动）、B5（迁移收口）、C3（迁移执行）的排期必须与该发版协调，避免 runtime 枚举变更与迁移窗口叠加。
2. **测试抖动残留**：A1 修复后仍有 2 个用例在全量并行负载下 5s 超时抖动（manager-url.test.ts、worker-runtime-config-panel.test.tsx，隔离单跑均通过）。建议 A1 顺带评估用例超时预算（全局 5s 对重 UI 用例偏紧），否则 CI 偶发红仍会侵蚀回归网可信度。
3. **RustFS 成熟度**：1.0 GA 时间短（约 2026-09），生产案例积累中；object cache 内存 issue（2026-04，转述）未息。缓解：阶段 0 门槛 + 观察期 + 回滚点；若 controller 团队评估后否决，备选为维持已有镜像（风险自担）或 Ceph/Garage/SeaweedFS，但「反向结论不成立」——source-only 状态下连拉补丁镜像都做不到，不迁移只是推迟风险。
4. **Controller 仓库不可公开访问**（api.github.com 404，已核实；是否私有未确认）：契约只能经 `docs/INTERFACES.md` 与上游 release notes 对齐；controller 内部是否使用 `mc admin` 等管理 API 未核实，RustFS 迁移的 controller 侧工作量是估计值。
5. **上游节奏不可控**：#1306 落定时间、minor 发版窗口、是否接 org.agentteams.run 协议均不受本仓控制；上游无公开 roadmap（未检索到），方向靠 release notes + PR/分支推断。缓解：B3 自动化对照 + 本方案所有上游相关条目均为「对齐」而非「单向先行」。
6. **未决的跨仓确认事项（RustFS 专项关键路径）**：① controller 切换后是否保留 `AGENTTEAMS_FS_*`/`AGENTTEAMS_MINIO_*` 导出别名（不保留则触发 dashboard.sh RUSTFS_* 回退条件项）；② 是否存在任务产物写入冻结手段（决定阶段 2 是「冻结写」还是「低峰+追平+小时间窗一致性」口径）。两项均由 C2 书面确认，未决前相关条目保持待定。
7. **未核实项清单（本方案如实标注，排期前请优先确认）**：
   - GitHub Actions 三流水线当前实际绿红（gh 无登录态，未能核实）；A10 落地前 CI 全绿仅是 `CHANGELOG.md:11` 自述；
   - npm outdated 的 Latest 列基于 npmmirror 代理，eslint 10 / TypeScript 7 / vitest 5 的实际发布状态未逐一联网核实（影响 A9 排期细度）；
   - minio/minio 的归档具体日期（2026-02-13 与 2026-04-25 两次）为二手转述；`archived=true` 状态本身已 GitHub API 直接核实；
   - RustFS 的生产案例（Milvus 评估中）、rclone 官方迁移文档（rustfs/rustfs#98）等为检索摘要，未读原文；
   - Claude Agent SDK / `claude -p` 的独立积分计费细节（2026-06-15 起）为搜索摘要，B6 立项前必须核实官方文档；
   - 「Managed Agents 2026-04 上线」「3 万+ MCP servers」「Coolify 290+ 模板」「40% 企业应用集成 agent」等趋势数字均为转述，只作方向参考，不作为决策依据；
   - 已复核（官方 registry）：`npm audit --omit=dev` 总数 13（8 高 5 中）与 GHSA advisory 清单、adm-zip 最新 0.6.1、nanoid v3 线 3.3.18/3.3.19。
8. **类型收紧的回归风险**：A6 第二/三步（清零 `: any`（39/36 两种口径见 2.1）、`noImplicitAny:true`）可能暴露隐藏类型问题，必须渐进（逐模块小 PR）并与 A5 拆分协同，禁止一次性大改。
9. **本地环境教训**：node_modules 与 lockfile 脱节叠加 Unix-only npm scripts（`package.json:6,8`）曾造成假失败；A7 落地前，任何贡献者按 README 首次跑三门都可能踩坑——这是 D1 CONTRIBUTING 必须写清 `npm ci` 约定的直接原因。

---

## 附录：证据来源与可信度说明

- **事实性结论**来自五份调研笔记（项目现状 / 上游 agentteams / Runtime 集成 / 对象存储迁移 / 趋势与吸引力，2026-09-28）；typecheck / lint / test / audit / outdated 等命令均在调研会话中实测执行，文中测试数字（如 1999/2011）沿用该次实测结果。
- 文中 `path:line` 引用经过抽样核对，行号以核对结果为准。
- **外部事实分级**：标注「已核实」的（上游 release、PR 状态、minio 归档状态、RustFS stars/文档、Node EOL、OpenClaw stars）来自对 api.github.com、docs.rustfs.com、nodejs.org、openclaw.ai 等来源的直接抓取；标注「转述 / 未深度核实」的（各趋势数字、部分 issue 细节）仅作方向参考，不作为决策依据，汇总见第 5 节第 7 条。
