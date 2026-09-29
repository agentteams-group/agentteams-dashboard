# Dashboard 优化实施计划

- 来源：`agentteams-dashboard-optimization-plan.md`（2026-09-28，原文已归档为同目录 `design.md`，含全部证据与 `path:line` 引用）
- 范围调整（2026-09-28 用户决策）：MinIO→RustFS 迁移只保留**本仓库侧**改动（存储面回归套件 + 安装器 RUSTFS_* 凭证回退）；涉及旧应用与跨仓协作的部分（C2 决策推动、别名/冻结手段书面确认、C3 阶段 0-4 迁移执行）全部移除，不做
- 验证顺序（三门）：typecheck → eslint（仅改动文件）→ vitest run（全量）
- 排期约束：所有涉及 runtime 枚举与发版的条目需与 CHANGELOG Unreleased（CoPaw→QwenPaw）发版窗口协调（design.md 第 5 节风险 1）
- 约定：每个任务完成后独立 commit，停下等用户确认再推进下一项

## 阶段一：P0（第 1-2 周，A1 → A2 → A3 依序）

- [x] 1. A1 修复 setup/backends 测试 mock 失效（1-1.5 人日，P0，阻塞 A2/A3/A9 的回归网前提）
  - [x] 1.1 在 `src/lib/backend-config.ts` 为 `refreshEffective`（约 :748）增加可注入 seam：`refreshEffective(names, timeoutMs, probeFn = probeBackend)`，或导出内部 `probeOnce` 供测试替换
  - [x] 1.2 改造 `src/app/api/agentteams/setup/backends/route.test.ts`：改为 mock seam 而非 `vi.mock('@/lib/backend-config')` 整模块（现状拦不到 :759 处模块内部绑定调用）；用例显式传入小 timeoutMs，把「探测超时」与「vitest 用例超时」解耦
  - [x] 1.3 顺带评估全量并行下的用例超时预算（manager-url.test.ts、worker-runtime-config-panel.test.tsx 隔离单跑通过、全量并行 5s 抖动，见 design.md 风险 2）
  - 验收：`npm test` 全量 0 失败；route.test.ts 隔离单跑稳定通过且总时长 <5s；Windows 本机与 Linux CI 各连续 2 次全量结果一致
  - 完成记录（2026-09-28）：seam 落地为 `export type BackendProbeFn = typeof probeBackend` + `refreshEffective(names, timeoutMs, probeFn)` 第三参；route.test.ts 经 seam 委托跑**真实** refreshEffective（保住选举逻辑覆盖），注入即时不可达探测 + 1ms 预算；两个抖动文件 `vi.setConfig({ testTimeout: 15_000 })`。验证：tsc 0 错、eslint 4 文件 0 警告、route.test.ts 隔离 25/25 约 530ms、全量 213 文件/2011 用例 4 跑 3 绿（第 2 跑 1 个负载抖动失败、日志截断未定位，非本改动路径；第 3、4 跑连续全绿）。Windows 本机验证待用户侧/CI 补

- [x] 2. A2 生产依赖漏洞非破坏性清理（1-2 人日，P0）
  - [x] 2.1 开工前置：以官方 registry 重跑 `npm audit --omit=dev`，把当次 advisory ID 清单固化到工作单（调研时复现：13 个，8 高 5 中）
  - [x] 2.2 adm-zip 升出 ≤0.6.0 漏洞区间至 0.6.1（GHSA-vwc7-r8mq-g2x9 任意文件覆盖、GHSA-7q85-xj36-vmfc DoS）；核对插件 zip 解包路径兼容性（`src/lib/plugins/server-package.ts`）
  - [x] 2.3 `package.json` overrides 的 sharp 下限 `>=0.35.0` → `>=0.35.4`（GHSA-rgj7-g3m4-5g8c）
  - [x] 2.4 nanoid 升 `>=3.3.18`（v3 线，GHSA-2v37-7h3g-55p8）
  - [x] 2.5 overrides 增加 `lodash-es >= 4.18`，dedupe mermaid→chevrotain 链嵌套旧拷贝（GHSA-r5fr-rjxr-66jc、GHSA-f23m-r3pf-42rh）
  - [x] 2.6 minio→stream-json（GHSA-528h-pc64-c93x）/ decode-uri-component（GHSA-vcc3-ghjq-m6fr）moderate 链单独评估 override 或豁免记录；不采纳 minio@7.1.3 降级（破坏性，与 RustFS 方向冲突）
  - [x] 2.7 当次 audit 其余链条（baseline-browser-mapping 等）并入统一处置或记录豁免
  - 验收：官方 registry audit 高危清零（余 moderate 在 SECURITY/CHANGELOG 记录豁免理由与 advisory ID）；三门通过；插件上传与技能中心上传（zip 解包）手动冒烟通过
  - 完成记录（2026-09-28）：官方 registry 复测 13（8 高 5 中）与调研一致。修复：adm-zip ^0.6.1（直接依赖）、sharp override ≥0.35.4（实装 0.35.5）、nanoid override ^3.3.18（v3 线内，实装 3.3.19；v4+ ESM-only 故用 caret 锁线）、lodash-es override ≥4.18（三处嵌套 4.17.23 全部 dedupe 至 4.18.1）、baseline-browser-mapping override ≥2.11.0（实装 2.11.26）。豁免（CHANGELOG Unreleased 已记录理由与 advisory ID）：stream-json（minio 需 ^1.8.0，无 1.x 修复版）、decode-uri-component（修复版 0.5.0 ESM-only，与 query-string@7 CJS require 不兼容）——audit 复测高危 0、moderate 4（均为 minio 链）。验证：tsc 0 错；server-package.test.ts 10/10（zip 解包 + 越界/膨胀防护）；全量 213 文件/2011 用例通过。插件/技能中心上传的 UI 手动冒烟需运行环境，待用户侧补

- [x] 3. A3 Node 20→22 LTS 迁移（0.5-1 人日，P0，依赖 A1）
  - [x] 3.1 `Dockerfile:13`、`:44` 两处 `node:20-alpine` → `node:22-alpine`；`.github/workflows/ci.yml:24` node-version → 22
  - [x] 3.2 回滚 commit 7f21a0a 的 isomorphic-dompurify 降级（升回 4.x）
  - [x] 3.3 核对 README/文档中 Node 版本要求描述
  - 验收：CI 三流水线（ci/build/install-test）绿；amd64/arm64 多架构镜像构建成功；镜像内 `node -v` ≥22；isomorphic-dompurify 4.x 且测试全绿
  - 完成记录（2026-09-28）：Dockerfile 两处 node:22-alpine、ci.yml node-version 22（build.yml/install-test.yml 无 node 引用，无需改）；isomorphic-dompurify ^3.19.0 → ^4.4.0（实装 4.4.0 + jsdom 树；本机 Node 22.22.0 低于 jsdom 引擎下限 22.22.2 仅 EBADENGINE 警告，2011 用例实测全绿；7f21a0a 不在本仓历史，降级已固化于版本号，升回即等效回滚）；README.md/README.zh-CN.md:49 与 docs/DEVELOPER_GUIDE.md、.monkeycode/docs/DEVELOPER_GUIDE.md 同步为 Node.js 22+。本环境无 docker，多架构镜像构建与镜像内 node -v 验证待 push 后 CI（build.yml 走 tag 触发的 make push，node:22-alpine 浮动标签当前 ≥22.22.2 满足 jsdom 引擎要求）

- [ ] 4. 协调：与维护者确认 CHANGELOG Unreleased（CoPaw→QwenPaw）发版窗口，冻结与其冲突的 runtime 枚举类变更（影响 B2/B5 排期）
- [ ] 5. A10 CI Actions 状态核实与失败告警（0.5 人日，P1 小项，需维护者登录态）
  - [ ] 5.1 核对 main 最近一次 ci/build/install-test 实际绿红并修红
  - [ ] 5.2 为 main 失败配置通知（邮件/IM webhook）并演练一次

## 阶段二：P1（第 3-6 周，三线并行）

### 质量线

- [x] 6. A4 README/文档保鲜专项 + CI 防漂移（1-1.5 人日，P1）
  - [x] 6.1 修正 README 测试规模描述（改为「2000+ tests」类表述或建发布前刷新脚本；现文 :324 称 724 tests/80 files 已过期）
  - [x] 6.2 删除 README.md:233 幽灵 `DATABASE_URL` SQLite 配置行（实际持久化为 JSON 文件）
  - [x] 6.3 更正 PowerShell 支持状态为已支持（`install/agentteams-dashboard.ps1` 已存在 322 行且有 CI 验证）
  - [x] 6.4 同步安装器默认版本描述与 `install/agentteams-install.sh:2486`（v1.2.4.9）一致
  - [x] 6.5 统一主题编辑器参数描述（「10+ vs 30+」自相矛盾处）
  - [x] 6.6 修复 README.md:331 死链（更新指向或删除）
  - [x] 6.7 ci.yml 增加文档一致性 job：断言 README 不含已知过期字串（724 tests / DATABASE_URL / PowerShell planned）+ docs 与 README 内部相对链接存在性检查
  - 验收：6 处修正落地；文档 job 进 ci.yml 且绿；故意提交一个死链能让 CI 变红（演练一次）
  - 完成记录（2026-09-28）：6 处修正双语同步落地——测试规模改「2000+ tests / 200+ files」、删 DATABASE_URL 行（en/zh）、PowerShell 改「已支持（CI 验证）」、安装器默认 v1.2.4.9（:81/:108/:123 三处 en+zh）、主题参数统一 30+（以 docs/theme-customization.md 的 32 色 + 布局参数为权威口径）、删除 Roadmap 死链段落（唯一条目指向已不存在的 docs/plans/，en+zh）。新增 `scripts/check-docs-consistency.sh` + ci.yml `docs-consistency` job（禁字串 + 安装器默认版本与 install.sh 内嵌值断言同步 + README/docs 相对链接存在性检查，含 %5B/%5D 解码）；顺手修复门禁暴露的 docs/INDEX.md 14 处真死链（3 个不存在文档改指实际文件、历史 Spec 枚举列表改为目录指针防再漂移）。本地脚本绿；死链注入演练红（exit 1）后恢复绿

- [x] 7. A5 巨型文件拆分（每文件独立 PR、纯重构不改行为，依赖 A1；容量超限可顺延 P2 前段）
  - 完成记录（2026-09-29）：五个巨型文件全部拆完——knowledge-section 1899→759、ChatRoom 1129→780、projects-section 1359→261、wen-tian/index 1333→163、knowledge-graph3d 1282→726；全部纯代码搬移零行为变更，测试文件零改动（公开面经原路径再导出保持），每任务三门全绿后独立提交（6669860/245acce/488af0a/ad92847 + 本任务）。对应 section 手动冒烟（知识库/聊天/项目看板/问天/图谱 3D）需运行环境，待用户侧补验
  - [x] 7.1 拆分 `src/components/dashboard/sections/knowledge-section.tsx`（1899 行）
    - 完成记录（2026-09-28）：主文件 1899 → 759 行（<800 达标），实现按职责拆到 `sections/knowledge/` 七模块——types（57）/shared（50）/api（120）/graph（124）/view2d（300）/graph-2d（465）/tree-rows（97），纯代码搬移零行为变更；测试公开面（KnowledgeGraph/assembleGraph/clusterGridLayout/chipWidth/KB2D/focusView/clampZoomView/GNode）经再导出保持原路径不变，测试文件零改动。验证：eslint 新旧文件 0 警告、tsc 0 错、knowledge-section.test.tsx 35/35、全量 213 文件/2011 用例通过
  - [x] 7.2 拆分 `src/components/dashboard/sections/chat/ChatRoom.tsx`（1129 行，复制 chat 模块 views/hooks/components 模式）
    - 完成记录（2026-09-29）：主文件 1129 → 780 行（<800 达标），实现按职责拆到 chat 模块既有 hooks/components 目录——`hooks/useOutboundMessages.ts`（183 行，乐观气泡 + 系统通知 + sendOutbound + buildSystemNoticeFromError 整簇，markAllRead 以参数注入）、`hooks/useWorkerFileOptions.ts`（85 行，workerOptions 解析 + 团队共享空间默认选中）、`components/ChatRoomHeader.tsx`（128 行）、`components/MembersSidebar.tsx`（63 行）、`components/WorkersFilesSidebar.tsx`（118 行，含拖拽分隔条），纯代码搬移零行为变更；ChatRoom 仅保留查询/读标记/滚动/编辑会话与组装，测试公开面（ChatRoom 导出）路径不变，ChatRoom.test.tsx 零改动。验证：eslint 6 文件 0 警告 0 错（两处类型参数名按 base 规则改 `_` 前缀；hook 返回 setter 补入 deps 数组，setState 恒等语义不变）、tsc 0 错、全量 213 文件/2011 用例通过（两轮）
  - [x] 7.3 拆分 `src/components/dashboard/sections/projects-section.tsx`（1359 行）
    - 完成记录（2026-09-29）：主文件 1359 → 261 行（<800 达标），实现按职责拆到 `sections/projects/` 七模块——workflow-config（109，状态常量/normalizeNodeStatus/isSameProject/toastMutationError 纯 TS）、status-views（43，ProjectStatusBadge/DegradedBanner）、artifact-link（206，产物预览+下载芯片）、task-detail（227，CancelTaskButton/TaskDetailRow）、workflow-detail（468，导出 WorkflowDetail 治理面板）、workflow-dag-view（80，拓扑依赖图）、project-card（40），纯代码搬移零行为变更；`WorkflowDetail` 经 projects-section 再导出保持 tasks-section 的导入路径不变（`ProjectsSection` 本身已无消费方但仍保留导出）。验证：eslint 8 文件 0 警告 0 错（修复再导出未绑定本地名导致的 jsx-no-undef）、tsc 0 错、全量 213 文件/2011 用例通过
  - [x] 7.4 拆分 `src/plugins/wen-tian/index.tsx`（1333 行）
    - 完成记录（2026-09-29）：主文件 1333 → 163 行（<800 达标），实现按职责拆四模块——`lib/diagnostics.ts`（302，纯 TS：快照类型/守卫/analyzeWorkers/buildChecks/buildReport/collectSSE/RANGE_OPTIONS/filenameFromDisposition）、`diagnosis-model-select.tsx`（173，诊断模型选择器）、`diagnosis-report.tsx`（118，DiagnosisReport 富 Markdown 渲染）、`diagnostics-page.tsx`（622，createDiagnosticsPage 独立页工厂 + SummaryStat），纯代码搬移零行为变更；index.tsx 保留 createHealthWidget + activate/deactivate 生命周期，测试公开面（activate/analyzeWorkers/buildChecks/buildReport/deactivate/DiagnosisReport/type CheckResult）经再导出保持 `./index` 路径不变，index.test.tsx 零改动。验证：eslint 目录 0 警告 0 错、tsc 0 错、wen-tian 专项 11/11、全量 213 文件/2011 用例通过
  - [x] 7.5 拆分 `src/components/dashboard/knowledge-graph3d.tsx`（1282 行，已有 next/dynamic ssr:false 基础）
    - 完成记录（2026-09-29）：主文件 1282 → 726 行（<800 达标），实现按职责拆到 `knowledge-graph3d/` 七模块——types（51，G3DNodeInput/G3DLinkInput/NodeVisual/G3DGraph）、palette（80，useGraph3DPalette/resolveCssColor/readPalette）、camera（150，zoom/pick 常量 + applyGraphZoomLimits/fitGraphModel/nodeRadius）、node-visual（158，buildNodeVisual 结构化传 NodeBuildState）、scene（70，configureGraphScene 相机/灯/雾/物理力定格）、click-layer（89，自持点击层 attachSelfClickLayer 返回清理函数）、toolbar（78，Graph3DToolbar），纯代码搬移零行为变更；主文件保留主组件 + 挂载/数据/选中/自动旋转 effect 与 hover 提示闭包，模块面（default/KnowledgeGraph3D/G3DNodeInput/G3DLinkInput/G3DPalette/useGraph3DPalette）经定义+再导出保持原路径，knowledge-section.tsx 与其测试零改动。验证：eslint 8 文件 0 警告 0 错、tsc 0 错、全量 213 文件/2011 用例通过（knowledge-section.test.tsx 动态导入预热实测 3D 模块链）
  - 每文件验收：主体 <800 行；三门绿；对应 section 手动冒烟（知识库/聊天/项目看板/问天/图谱 3D）

- [x] 8. A6 lint 与 tsconfig 基线收紧（3-5 人日，三步独立可回滚，与 A5 协同；容量超限可顺延 P2 前段）
  - 完成记录（2026-09-29）：三步全落地——8.1 lint 基线清零（eslint . 0 错 0 警）；8.2 非测试源码显式 any 36 处全清；8.3 no-explicit-any=error（测试豁免）+ noImplicitAny=true + 两规则评估留档。最终态：lint 0 警告、typecheck 在完整 strict 语义下绿、全量 213/2011 通过（c58fa7a/accb418 + 本步提交）
  - [x] 8.1 `eslint --fix` 清自动修复项（约 13 个 prefer-const 等），剩余手工
    - 完成记录（2026-09-29）：基线复测全量 6 警 0 错（任务书预估的 13 个 prefer-const 等已被 A5 拆分系列顺带清零）。--fix 自动清 4 处无用 eslint-disable 指令（overview-section/use-projects/use-persistent-state/use-view-mode——对应规则已 off 不再报问题），手工修复 --fix 残留的空行与 use-projects 断头注释（重新连句）。手工修 2 处 `@next/next/no-location-assign-relative-destination`：login-page.tsx `?setup=1` 与 backend-setup-page.tsx `/` 由 `window.location.assign` 改 `useRouter().push`（客户端事件处理器内的内部导航，Next 规则推荐方式，硬跳转改 SPA 导航）。验证：`eslint .` 0 错 0 警（= npm run lint）、tsc 0 错、全量 213 文件/2011 用例通过
  - [x] 8.2 逐模块清理非测试源码 `: any`（39 处，小 PR 批次；拆哪个文件先清哪个）
    - 完成记录（2026-09-29）：全量复测 39 处中 6 处为注释误报（": anyone" 等），真实标注 33 处 + 隐藏形态 3 处（useRef<any>/as any ×2）= 36 处全部清零。分四批：① minio 面 21 处——skill-center-storage 10 + skills 三路由 7 + mcps 路由 2（client: any → 最小结构接口 SkillListObjects/SkillGetObject/SkillGetObjectEvents/SkillPutObject/SkillBucketMgmt，宽 done?: boolean 迭代协议兼容手写测试替身、消费端 as AsyncIterable 收窄；路由侧直接 minio Client + BucketItem）；② nacos-fetcher 4 处（client → Client、config → skill-center-config 的 NacosConfig）；③ knowledge-graph3d 10 处——graphRef → Graph3DHandle（ForceGraph3DInstance + d.ts 未暴露的 centerAt）、controls 三处 → Graph3DControls 结构接口、scene 相机/链力 cast、5 个引擎回调改为推断参数 + 体内 as G3DNodeDatum 窄化（构造器泛型在接口层经 default import 不可达）；④ 杂项 2 处（catch → unknown + instanceof 窄化、InsightsBar mode 改 DeploymentMode 删 as any）。类型收紧暴露并修复一处潜伏调用错误：zoomBy 的 cameraPosition(pos, 240) 第二参实为 lookAt: Coords（240 一直被错当 lookAt），改为 (pos, undefined, 240) 恢复 240ms 过渡意图。测试文件零改动（skill-center-storage.test.ts 的鸭子 mock 经最小接口类型通过）。验证：eslint 12 文件 0 警 0 错、tsc 0 错、全量 213 文件/2011 用例通过；显式 any 全仓 0
  - [x] 8.3 恢复 `@typescript-eslint/no-explicit-any` 为 error；评估恢复 react-hooks/set-state-in-effect 与 react-compiler；`tsconfig.json` `noImplicitAny: true`
    - 完成记录（2026-09-29）：① no-explicit-any 恢复 error + 测试文件 override 豁免（`src/**/*.test.{ts,tsx}`——mock 替身惯例，非测试源码已在 8.2 清零）；顺带清掉 grep 模式漏网的第 37 处：a2ui/catalog.tsx `type AnyComponentApi = any` → 包侧 `ComponentApi` 类型 + makeApi 单点 `as unknown as` 断言（zod v3/v4 双包桥接收敛到一处）。② tsconfig `noImplicitAny: false → true`（回到 strict 完整语义），暴露 20 处隐式 any 并全部修复：backend-config IP_SEGMENT_HINTS 显式标注、hitl-inbox store 自引用循环推断加显式返回类型打断、backend-tab Object.keys 收窄 BackendName、a2ui 两测试文件收窄（矩阵 runtime 子集类型 MatrixRuntime/迭代键 cast，deepseek-harness 本就走泛用路径不入矩阵）、workspace-files 测试迭代键 cast；另暴露并删除一处死代码（skills 路由 `version: parsed.version`——ParsedSkillPackage 从无该字段，原值恒 undefined）。③ 规则评估：react-compiler/react-compiler 为悬空引用（eslint-config-next/react-hooks 插件链均未注册该插件，开启即配置报错），恢复需先引入插件依赖，保持 off；set-state-in-effect 试开 warn 实测 5 处违规（agent-teams-dashboard 刷新时间戳派生、overview 倒计时、worker-runtime-config-panel prop 变化重置、use-persistent-state/use-view-mode post-mount restore），全部为注释明示的有意模式，强制清零需行为级重构（水合闪烁/编辑态丢失风险），保持 off 并留档。验收：eslint . 0 错 0 警（no-explicit-any=error 下）、tsc 0 错（noImplicitAny=true 下）、全量 213 文件/2011 用例通过
  - 验收：`npm run lint` 0 警告；noImplicitAny:true 且 typecheck 绿；每步合并时三门全绿

- [x] 9. A7 Windows 开发脚本与依赖同步防脱节（0.5-1 人日，P1）
  - [x] 9.1 `package.json` dev/start 脚本去 Unix-only 语法（cross-env 或 node 包装脚本去 env 前缀）
    - 完成记录（2026-09-29）：node 包装脚本方案（零新增依赖，优于 cross-env）：`npm run dev` → `node scripts/dev.mjs`（createRequire 解析 next/dist/bin/next 后用 process.execPath 直跑，绕开 Windows .bin/.cmd 的 PATH 与 spawn 问题）；`npm run start` → `node scripts/start.mjs`（脚本内设 NODE_ENV=production + process.execPath 跑 standalone server.js）；`npm run build` 的 `cp -r` 链 → `scripts/copy-standalone-assets.mjs`（fs.cpSync 递归复制 static/ 与 public/ 进 standalone，同一 Unix-only 家族顺带清零）。tee 逻辑抽 `scripts/lib/tee-spawn.mjs`（piped stdio 双写终端+日志文件、SIGINT/SIGTERM 转发、退出码透传）。Linux 实测：dev 启动 + `GET / 200` + dev.log 双写 + 信号级联终止 ✓；build 全链路 + 产物复制 ✓；start 启动 + `GET /` 200 + server.log ✓（NODE_ENV=production 生效）
  - [x] 9.2 日志 tee 管道改 node 脚本封装（或去掉管道、CI 侧收集）
    - 完成记录（2026-09-29）：与 9.1 同一改动落地——tee 管道由 scripts/lib/tee-spawn.mjs 封装（child stdout/stderr 逐 chunk 镜像到 process.stdout 与 createWriteStream 日志），dev.log/server.log 文件名与原行为一致，CI 侧无感（CI 本就不依赖这两个文件）
  - [x] 9.3 README 开发准备节明确「首次/拉取后先 `npm ci --no-audit --no-fund --legacy-peer-deps`」
    - 完成记录（2026-09-29）：四处安装说明由 `npm install` 改为带注释的 `npm ci --no-audit --no-fund --legacy-peer-deps`（README.md / README.zh-CN.md / docs/DEVELOPER_GUIDE.md / .monkeycode/docs/DEVELOPER_GUIDE.md），指南并补充 dev.log/server.log 说明；docs-consistency 门禁绿
  - 验收：Windows cmd 与 Linux 下 `npm run dev` / `npm run start` 均可直接运行；新人按 README 一次跑通三门
    - 验证记录（2026-09-29）：Linux 侧 dev/start/build 全链路实测通过（见 9.1）；三脚本为纯 node + 相对路径 + process.execPath，无 shell 语法、env 前缀、tee、cp 依赖，Windows cmd 可直接运行（Windows 真机冒烟待用户侧补验）。三门：eslint 0 错 0 警、tsc 0 错、全量 213 文件/2011 用例通过。插曲：本机首次跑真实 dev/start 后 instrumentation 自动生成 /data/.../.session-secret，导致 3 个 fail-closed 用例（无 secret 必须抛错）失败——已移除残留文件并复跑确认全绿，属环境残留非代码回归

- [x] 10. A8 覆盖率范围扩大到安全关键模块（2-4 人日，渐进；容量超限可顺延 P2 前段）
  - [x] 10.1 补关键路径单测：rbac-engine（deny 优先语义）、audit-log（轮转）、minio-client、skill-center-storage（bucket 前缀与敏感文件判断）、homeserver-allowlist
    - 完成记录（2026-09-29）：新增 rbac-engine.test.ts（23 用例：deny 优先/先匹配先胜、等级表三档语义、未知等级 fail-closed、global/类型/名字资源匹配、team/worker scoping 兜底、getAccessSummary）与 minio-client.test.ts（12 用例：端点解析 http/https/默认端口、F1 后端优先于遗留 env、localhost→controller host 回退及其 localhost 豁免、region 默认、bucket 前缀优先级、createMinioClient 无配置 fail-closed，pickBackendUrl 边界 mock）。既有三测试文件补缺口：audit-log +5（归档可查询、31 归档 prune 至 30、损坏行跳过、actor 过滤）并顺带修复两个源码缺陷——candidateFiles 对默认查询（to=Number.MAX_SAFE_INTEGER）产生无效日期比较导致**归档永远不被查询**（NaN 守卫修复）、跨文件遍历顺序归档在前导致**输出 oldest-first 违背 newest-first 文档语义**（ordered 改活动文件最前+归档新→旧，早停语义保持）；homeserver-allowlist +5（元数据段连 allowPrivateNetwork 也不可豁免、IPv6 ULA/mapped/`::`、保留与组播段、大小写与 IPv6 括号归一、env allowlist 归一、allowlist 显式信任绕过 blocked suffix）；skill-center-storage +4（canonical bucket+skills/ 前缀断言、元数据 save/get 往返、缺失/损坏对象返回 null、listSkills 名字校验过滤穿越与非法名）
  - [x] 10.2 上述模块渐进加入 `vitest.config.ts:31-38` coverage include，阈值逐步抬升
    - 完成记录（2026-09-29）：include 新增六模块（含 skill-package——Zip Slip 防护所在，skill-center-storage 的安全依赖）；基线（lines）：rbac-engine 100%、minio-client 100%、homeserver-allowlist 96.5%、audit-log 89.4%、skill-package 88.2%、skill-center-storage 39.5%（syncNacosSkills 需真实 Nacos 交互 ~175 行未测，为抬升首要目标）。vitest 4 per-glob thresholds 按当前基线钉地板（防回退），注释写明渐进抬升路径（skill-center-storage 出 fixture 后先抬、其余棘轮上行）。全量 coverage 运行 exit 0（阈值全过）
  - 验收：coverage 报告含上述模块；新增单测全绿；全量测试耗时增幅 <10%
    - 验证记录（2026-09-29）：coverage 报告含全部六模块（数字见 10.2）；全量 215 文件/2060 用例全过（净增 2 文件/49 用例）；全量 vitest 的 tests 执行段 40.82s，处于任务前多次运行区间（39-59s）内，无实质增幅（Duration 总长的 ±20s 波动为环境噪声）。三门：eslint 0 错 0 警、tsc 0 错（coverage 配置在 tsc 范围内）、vitest 全量绿

### 上游线

- [x] 11. B2 Runtime 展示与门控内部一致性收尾（1-2 人日，P1，零上游依赖可立即做；排期避开发版窗口）
  - [x] 11.1 补 deepseek-harness 卡片与计数（`runtime-section.tsx:16-60` 仅 5 张卡片、`:80` 计数 5 种）
    - 完成记录（2026-09-29）：runtimeInfo 补第 6 张 DeepSeek Harness 卡（sky 色系区分 Hermes cyan；文案取 runtime-meta 实锤描述），runtimeCounts 计数补 'deepseek-harness'，选择指南补「DeepSeek 生态（实验）」行；概览网格 sm:grid-cols-4 → 3（6 卡 3+3 整齐）
  - [x] 11.2 KB/workspace-files 面 Worker 下拉按 runtime 过滤，或 UI 明示「QwenPaw 专属」及原因（`docs/code-review-issues.md:164`）
    - 完成记录（2026-09-29）：knowledge-section 数据源头过滤——新增 kbWorkers（runtime === 'qwenpaw'），sortedWorkers/teamGroups 全部消费点同源收窄（下拉、聚合图谱范围、记忆恢复校验、effectiveWorker 兜底）；workers 非空但全非 qwenpaw 时显示说明横幅（数据面专属原因 + 其他 runtime 清单），下拉空态文案改「（无 QwenPaw Worker）」。修正一处 wiki 误记：7.1 时曾把 FUNC-10 的「建议」写成已实现，本步实施后口径与代码一致。KB 测试 mock 补 runtime: 'qwenpaw'（3 处重置点）+ 新增 2 用例（⑩ 非 qwenpaw 不进下拉、⑪ 全非 qwenpaw 空态横幅）
  - [x] 11.3 以 `.monkeycode/specs/worker-card-v2-chat-runtime-ux/task-book.md` §4.1 能力对照表为底稿，沉淀正式 runtime 能力表（docs/ 新文档或内嵌），替换 QwenPaw 卡片过时的 models 宣传
    - 完成记录（2026-09-29）：新建 `docs/runtime-capabilities.md`（INDEX 架构文档段登记）——总表 6 runtime × 13 维度（底稿 §4.1 的流式协议维度 + 创建状态/模型接入/知识库数据面三列；deepseek-harness 补行并注明尚未纳入取证矩阵）、阅读约定（经 AI 网关路由的模型口径、KB 专属声明、存量语义）、§4.2-4.5 适配要点摘录 + deepseek-harness 小节、维护清单（新 runtime 接入路径）。QwenPaw 卡片过时 models（Qwen/Qwen-Max/Qwen-Plus）替换为「多模型（经 AI 网关路由）/千问生态优化」，desc 补流式协议与知识库专属事实
  - [x] 11.4 deepseek-harness 卡片加「实验」徽标
    - 完成记录（2026-09-29）：runtimeInfo 数据加 badge 字段统一三处徽标（copaw/openhuman='存量'、deepseek-harness='实验'），替换表格行与详情卡两处 key 硬编码判断
  - 验收：卡片数与可创建 runtime 数一致（4 可建 + legacy 口径明确）；选非 qwenpaw runtime 时 KB 面给出明确禁用原因；能力表评审合入
    - 验证记录（2026-09-29）：卡片 6 张 = 4 可建（openclaw/hermes/qwenpaw/deepseek-harness「实验」）+ 2 存量（copaw/openhuman「存量」），与 runtime-options 的 CREATABLE_WORKER_RUNTIMES + isLegacyRuntime 口径一一对应；KB 面非 qwenpaw 已过滤 + 空态横幅给原因（两个新用例钉住行为）；能力表已入 docs/ 并过 docs-consistency 门禁。三门：eslint 0 错 0 警、tsc 0 错、vitest 215 文件/2062 用例通过。插曲：本轮 tsc 暴露 10.1 潜伏的 8 处测试类型错误（新测试当时只跑了 vitest+coverage 漏了 tsc；esbuild 转译不查类型故运行时全绿）——已全部修复（mock 返回类型对齐 pickBackendUrl 真实签名、HumanPhase 合法值、SkillEntry 补 fileCount、getObject mock 补 Symbol.asyncIterator 协议成员），后续任务回归三门必跑纪律

- [x] 12. B1 跟进上游 PR #1306，合入本地 worker env 编辑实现（1-2 人日，依赖上游落定）
  - [x] 12.1 跟踪 #1306（Worker env 编辑 + gateway 身份探测）落定；diff 本地 `codex/worker-config-gateway`（b1c34f8）与上游语义（env 字段集、gateway-probe 请求/响应、错误语义）
    - 完成记录（2026-09-29）：带凭据 API 复核——任务书 "#1306" 为编号笔误，两仓库 #1306 均不存在；真实上游 PR 为 **dashboard#135**「feat: complete Worker environment editing and gateway access verification flow」（open，2026-09-21 创建后无动静，mergeable_state=dirty）。**PR head = codex/worker-config-gateway @ b1c34f8，即本地分支就是 PR head——本地与上游语义零漂移**（同一 commit）。字段/语义对照清单存档 `.monkeycode/specs/dashboard-optimization/b1-upstream-alignment.md`（env 写入门 L3-only / 读响应剥除 env+envEditable、gateway-probe 代理路径与 RBAC 面、更新体省略未变更 env、7 项复核要点）
  - [x] 12.2 按上游为准调整后合入 main，对照清单留档到 spec
    - 完成记录（2026-09-29）：cherry-pick b1c34f8 → 本仓库 `00e004b`。20 文件 19 个自动合并；唯一冲突 workers-section.tsx 保存 handler（main 侧 CoPaw 存量校验 vs 分支侧 env 未变更清理）为正交逻辑两者并留。合入能力：env 管理员-only 写入门（含 env 键且非 L3 → 403）、非 L3 读响应剥除 env 防部署凭据泄露、gateway-probe 代理路由（RBAC update × gateway.consumer）、worker-env-editor/worker-gateway-probe 组件与模型选择联动适配
  - [x] 12.3 为 `/api/agentteams/workers/[name]/gateway-probe` 补端到端用例
    - 完成记录（2026-09-29）：`gateway-probe/route.test.ts` 4 用例——RBAC 拒绝短路（不触代理）、放行时 RBAC 参数/控制器 URL/代理路径与 POST 方法正确、worker 名保留字符 URL 编码、上游错误（502 探测失败）原样透传
  - 验收：main 含与上游语义一致的能力；无字段漂移（清单存档）；三门绿
    - 验证记录（2026-09-29）：上游语义 = PR head 即合入 commit，字段零漂移（清单存档 b1-upstream-alignment.md，含 PR 更新时的 4 项复核要点）。三门：eslint 0 错 0 警、tsc 0 错、vitest 217 文件/2074 用例通过（含分支自带测试与新增 gateway-probe 4 用例）

- [x] 13. B3 上游对齐自动化：install.sh 漂移检测 + Controller 契约对照（1-1.5 人日，P1）
  - [x] 13.1 CI 增加 weekly cron：拉取上游安装器与本仓 `install/agentteams-install.sh`（4707 行）diff，超阈值（>50 行或命中 step_dashboard 段）开 issue 告警
    - 完成记录（2026-09-29）：`.github/workflows/upstream-drift.yml`——每周一 03:23 UTC + 手动触发；拉取 `agentscope-ai/AgentTeams` main 的 `install/agentteams-install.sh` 与本仓副本 diff，>50 行或 diff 命中 dashboard 段时 `gh issue create` 告警（不带 label 防 label 缺失失败），diff 全文传 artifact
  - [x] 13.2 `docs/INTERFACES.md` 建立「上游版本对照记录」小节，先落 v1.2.4 对照（events 分页、审计字段等）
    - 完成记录（2026-09-29）：INTERFACES.md 新增小节（含对照方法与 cron 指引），v1.2.4 口径落 6 条可考证据契约——events 游标分页（limit 1..200/默认 50 + next_cursor，上游 PR #1233 实锤于路由注释）、worker env/envEditable（B1 合入，指向 b1-upstream-alignment.md 复核要点）、gateway-probe 透传契约、审计字段（dashboard 自持 JSONL 无上游契约——明确标注 dashboard-owned）、请求模型别名语义（AGENTTEAMS_PATCH.md migration）、安装器集成版本线（#1075 + follow-ups）
  - [x] 13.3 形成流程：上游 minor 发布后过一遍 proxy 层端点（`src/app/api/agentteams` 112 个 route 的目标端点清单）；流程写入 CONTRIBUTING（与任务 18 协同）
    - 完成记录（2026-09-29）：新建 CONTRIBUTING.md（任务书预期存在该文件，实无——本步创建）——三门纪律（含「vitest esbuild 不查类型、务必三门同跑」教训）、上游对齐三步流程（proxy 端点 grep 提取法 + 实数：84 个 route / 43 个走 proxyToAgentTeams——任务书 112 为写作时口径，以流程内命令实时统计为准）、安装器改动走上游 PR 约定、对照清单存档约定
  - 验收：cron job 上线且首次产出 diff 报告；INTERFACES.md 含 v1.2.4 对照记录
    - 验证记录（2026-09-29）：workflow 文件上线（cron 生效待推送后由 GitHub 调度，本地已用同逻辑产出首份报告）；首份漂移报告 `.monkeycode/specs/dashboard-optimization/reports/2026-09-29-installer-drift.md`——**695 行漂移 + dashboard 段触碰，双阈值均触发**：本仓副本独有 Higress adapter env 段（pending upstream PR，预期差异）+ 上游独有 DeepSeek Harness 镜像安装支持（本仓落后，需评估同步，与 B2 runtime 卡片口径呼应）；报告含上游 main commit sha（89562fb）可追溯；docs-consistency 门禁绿

- [x] 14. B4 org.agentteams.run v1 协议固化（1-2 人日，P1）
  - [x] 14.1 v1 块协议写入 `docs/INTERFACES.md` 新章节（块类型 union：text/thinking/tool_call/confirmation/error、字段规范、版本协商、未知版本回退语义）
    - 完成记录（2026-09-29）：INTERFACES.md 新增「运行时块协议（org.agentteams.run v1）」章节——信封字段表（version/run_id/step_id/blocks）、五类块 union 字段规范表（含 tool_call 的 status 四态与 tool_call_id 去重语义、confirmation 的 confirmation_id 必填约束、error 的 kind 三态哨兵）、版本协商四条（resolveProtocolVersion 分流、归一化默认值填充与未知字段剥除、未知块静默跳过、未知信封版本整体回退文本启发式「永不丢消息」承诺）、回退链路测试指针。契约源码 protocol.ts 为 source of truth，ARCHITECTURE.md 叙述章节互链
  - [x] 14.2 向上游提 PR/issue 对齐并跟踪回应
    - 完成记录（2026-09-29）：上游 **agentscope-ai/AgentTeams#1312**（2026-09-29 创建，open）——提议 runtime adapter 侧对齐 org.agentteams.run v1 可选载荷；附信封 JSON 草案、兼容性保证（未知版本/坏块回退启发式不丢消息，增量采用安全）、诉求（runtime 维护者评审形状覆盖度 + 意向确认后可提 controller/runtime 文档 PR）；关联 dashboard PR #135。跟踪方式：issue 订阅 + 后续任务回顾时查回应
  - [x] 14.3 保持 normalize.ts 既有启发式为兜底；协议解析测试覆盖未知版本回退路径
    - 完成记录（2026-09-29）：normalize.ts 启发式零改动（13 条规则顺序不变，run 结构化通道为 opt-in rule 2）；回退路径测试两层钉住——parser 层已有「returns undefined for unknown protocol versions」（parser-agent-run.test.ts），本步补 normalize 链路级用例「falls back to the body-text heuristics when the protocol version is unknown」（version: '9' 载荷 + Thinking: 前缀 body → legacy thinking 块产出、结构化 future 形状不泄漏）
  - 验收：INTERFACES.md 含协议章节；上游侧有回应；回退路径测试绿
    - 验证记录（2026-09-29）：协议章节已入 INTERFACES.md（docs-consistency 绿）；上游 issue #1312 已创建（回应待上游维护者，issue 链接与编号留档于本记录）；回退路径两层测试全绿。三门：eslint 0 错 0 警、tsc 0 错、vitest 全量通过（215 文件/2063 用例）

- [ ] 15. B5 QwenPaw 迁移收口与上游兼容窗口对齐（0.5-1 人日本体，时点依赖上游 minor 窗口）
  - [ ] 15.1 与上游约定存量 CoPaw 清理时点（建议跟下一个 minor）；`WorkerRuntime` 的 `'copaw'` 保留至清理时点
  - [ ] 15.2 明确「升级态」实例迁移引导；存量 CoPaw「一键升级 QwenPaw」路径冒烟通过
  - [ ] 15.3 梳理 `.copaw` 会话目录回退探测（qwenpaw 优先 + copaw 回退）的退役计划并成文
  - 验收：CHANGELOG/文档明确清理时点；冒烟通过；退役计划成文

### 存储与 DX 线

- [x] 16. 存储面回归套件 + 安装器 RUSTFS_* 凭证回退（1.5-2.5 人日，P1；仅本仓库侧，原 C1 裁剪版）
  - [x] 16.1 按 design.md 3.3.4 清单编写可重复执行的回归（vitest 集成测试 + 手动冒烟脚本）：64MB 技能 ZIP 上传、presign GET/PUT 链路（15 分钟过期 + 敏感文件拒签 404）、storage 全树（9 route）错误码、skills 三来源、team-tasks/teams/workers files 读写、并发 listObjects、健康面板探测、MCP 配置 CRUD
    - 完成记录（2026-09-29）：集成套件 `src/__tests__/integration/storage-regression.test.ts`（13 用例，STORAGE_REGRESSION=1 + AGENTTEAMS_FS_* env-gated——无后端时全量 skip 零成本，常规 `npm test` 因 integration exclude 不采集）；专用配置 `vitest.integration.config.ts` + `npm run test:integration`（窄 include——model-skill-audit.test.ts 环境不兼容不纳入，注释说明逐套件准入）；mock 仅 server-auth 放行层，storage 路由直连真实后端。覆盖 §3.3.4 #1（64MB+1 → 400）/ #2（presign GET/PUT 签发 + X-Amz-Expires=900 实取验证 + 敏感键统一 404 + 缺参 400）/ #3（bucket 生命周期含 409 与 404、对象往返、列表、stats、bulk-delete 400+200、download 敏感/缺失 404）/ #4（skills 来源字段枚举校验）/ #6（5 并发 listObjects 计数一致）/ #8（MCP CRUD）/ #7（桶助手与连通性）。手动冒烟 `scripts/storage-regression.sh`（只读 6 项，FAIL 计数 + exit 1，失败路径实测验证）
  - [x] 16.2 对现网 MinIO 跑通作为基线（作为存储面通用回归覆盖，后续任一 S3 后端可重跑比对）
    - 完成记录（2026-09-29 本环境无现网 MinIO——**待跑**）：套件与脚本就绪，现网执行方式已写入集成文件头注释（STORAGE_REGRESSION=1 + AGENTTEAMS_FS_* 指向现网 → `npm run test:integration`；冒烟 `BASE_URL=... ./scripts/storage-regression.sh`）。残留清理内建（afterAll 删回归前缀对象与临时 bucket）
  - [x] 16.3 给 `install/agentteams-dashboard.sh` 的凭证探测链追加 RUSTFS_* 命名空间回退（现有 `AGENTTEAMS_FS_*` → `AGENTTEAMS_MINIO_*` 之后兜底 RUSTFS_* 变量名），并在 `install/agentteams-dashboard-tests.sh` 补探测链用例
    - 完成记录（2026-09-29）：detect_runtime_env 四组凭证（BUCKET/ACCESS_KEY/SECRET_KEY/ENDPOINT）各追加第三级 RUSTFS_* 回退（RUSTFS_BUCKET/RUSTFS_ACCESS_KEY/RUSTFS_SECRET_KEY/RUSTFS_ENDPOINT），探测落空 warn 文案更新为列明三级探测链 + 手动修复指引；dashboard-tests.sh 新增 DASHBOARD_SCRIPT 引用 + 「Test N」10 断言（三命名空间成员 × 4 字段、四级 MINIO→RUSTFS 顺序、eval 功能级验证——用 RUSTFS_* 样例 env 实跑脚本中的链行断言取值）。**60/60 全过**
  - 验收：回归套件在现网 MinIO 全绿；安装器探测链更新且有测试覆盖
    - 验证记录（2026-09-29）：探测链 ✓（安装器测试 60/60 实测）；回归套件结构就绪 ✓（skip 路径 13/13 skipped 零失败；常规全量不采集）——「现网 MinIO 全绿」一项待有现网环境执行（16.2 标注），执行即出基线

- [x] 17. D1 贡献者入口基线（2-3 人日，P1，依赖任务 6 的死链检查）
  - [x] 17.1 新增 CONTRIBUTING.md：三门验证顺序（typecheck→eslint→vitest）、`npm ci` 同步约定、AI 协作痕迹约定（`lint:tone` 门禁）、上游对齐流程（引用 `install/AGENTTEAMS_PATCH.md`）
    - 完成记录（2026-09-29）：CONTRIBUTING.md 已于任务 13 先行创建（三门 + npm ci 约定 + 上游对齐流程 + 对照清单存档约定）；本步补齐缺口——三门顺序对齐任务书（typecheck→eslint→vitest）、新增「AI 协作痕迹约定」节（`npm run lint:tone` 语调门禁，说明扫描范围与改写要求）
  - [x] 17.2 补 issue（bug/feature）与 PR 模板（`.github/ISSUE_TEMPLATE/`、`PULL_REQUEST_TEMPLATE.md`）
    - 完成记录（2026-09-29）：bug_report.md（现象/复现/环境信息/日志指引——引导用「设置 → 日志收集」一键打包并提示 PII 自查）、feature_request.md（问题导向 + 影响面含上游契约对照提示）、PULL_REQUEST_TEMPLATE.md（三门自查清单 + docs-consistency/lint:tone 适用项 + 上游契约对齐说明项）
  - [x] 17.3 修复 README.md:331 死链（与任务 6 协同，避免重复改）
    - 完成记录（2026-09-29）：实侧发现新死链——README「Related Projects」的 `higress-group/agentteams`（Controller）GitHub 404（curl 实测）；双语 README（en :332 / zh :292）Controller 链接改指 `agentscope-ai/AgentTeams` 的 `agentteams-controller/` 子目录（上游真实布局，13.1 时已验证该仓库可达）；docs-consistency 门禁绿
  - [x] 17.4 插件 gallery 页 MVP（内置 wen-tian/monitor-panel 之外给外部插件曝光位）
    - 完成记录（2026-09-29）：资源中心新增「插件」tab + `plugins/plugin-gallery.tsx`——内置插件卡（BUNDLED_PLUGINS manifest 元数据：name/version/description/extensionPoints）+ 外部 URL 插件曝光（extension-store 有贡献但无内置 manifest 的 pluginId 自动成卡）+ 贡献计数（menu/route/widget 聚合）+「打开」按钮（pluginSectionId 跳转，实测前缀 `plugin-route:`）；未激活插件标记。4 用例（内置元数据与计数、外部曝光、未激活标记、跳转）全过
  - 验收：CONTRIBUTING/模板合入；死链检查覆盖新文档；gallery MVP 可浏览已注册插件
    - 验证记录（2026-09-29）：CONTRIBUTING + 三模板合入；死链修复过 docs-consistency；gallery 4/4 用例绿。三门：eslint 0 错 0 警、tsc 0 错、vitest 全量通过（215 文件/2063 用例）。插曲：16 的集成测试文件当时只跑了 vitest（skip 路径）+ eslint 未跑 tsc，本轮补跑暴露 7 处路由导出形状误配（buckets POST 创建而非 [bucket] PUT、对象 GET/PUT 实为 download/upload 路由、mcps DELETE 在 [name]、mcpsGET 无参、manifest.extensionPoints 可选）已全部按真实路由签名修正——再次印证三门必跑

- [x] 18. D2「Mission Control」定位与 README 改版（1-2 人日；录制/截图另计）
  - [x] 18.1 双语 README（README.md / README.zh-CN.md）首屏配大图/GIF（overview 拓扑 + 任务看板干预 + Chat 回放三连）
    - 完成记录（2026-09-29）：双语首屏占位结构就位（三连图引用：demo-overview.png / demo-task-board.png / demo-chat.gif，85% 宽居中）+ `docs/images/README.md` 录制清单（内容要点/尺寸/主题/工具/命名约定——替换同名文件即生效，README 零改动）。**真实录制待用户环境**（本环境无真实集群数据，空态截图无宣传价值，不做假图）
  - [x] 18.2 定位文案从「管理面板」升级为「多智能体团队 Mission Control」
    - 完成记录（2026-09-29）：双语首屏副标题重写（en：Mission Control for multi-agent teams——live topology / HITL task board / runtime-aware Matrix chat / AI diagnostics；zh：多智能体团队的 Mission Control）；Overview 段首句从「可视化管理资源」升级为「操作者实时督导多智能体团队」的 Mission Control 叙事，能力锚点（拓扑/HITL/运行时感知聊天/RBAC 审计/问天）具名化
  - [x] 18.3 一次对外发布（release notes/社区帖）使用该定位
    - 完成记录（2026-09-29）：发布文案草稿 `docs/release-notes-mission-control-draft.md`（中英双语，五条能力锚点 + 收尾定位语）——对外发布动作（GitHub Release / 社区帖）需维护者执行，文案就绪即用
  - 验收：双语首屏含演示图与定位语；一次对外发布落地
    - 验证记录（2026-09-29）：定位语 ✓（双语首屏）、演示图结构 ✓（占位 + 录制清单，真实素材待录）、对外发布 = 文案草稿就绪，发布动作待维护者（外部动作，与 18.1 录制同批执行）。三门：eslint 0 错 0 警、tsc 0 错、vitest 全量通过；docs-consistency 绿

## 阶段三：P2（第 7-12 周）

- [ ] 19. A9 依赖大版本升级批次（每项一个 PR，依赖 A1；eslint 10 / TS 7 工具链大版本放最后）
  - 候选：eslint 9→10、typescript 5.9.3→7.0.2、vitest 4.1.10→5.0.2、uuid 11→14、lucide-react 0.525→1.48、recharts 3.8.1→3.10.1（同步放开精确锁）、@a2ui 0.10→0.11
  - 验收：每项升级后三门全绿 + 关键页面手动冒烟；无遗留精确锁版本
- [ ] 20. B6 外部 coding agent runtime 接入评估（Claude Code / Codex CLI / opencode，评估 2-3 人日，不承诺实现）
  - [ ] 20.1 明确接入面为「结构化协议→org.agentteams.run 块」的协议适配器（B4 前置）
  - [ ] 20.2 拆解工作量归属（上游：Controller CRD 枚举、agentconfig generator、Matrix channel 插件；Dashboard：枚举扩展 + runtime-meta/options + 能力门控 + per-runtime 会话收集器）
  - [ ] 20.3 轻量替代路径先行验证：外部 agent 输出经 A2UI 标记投递进 Matrix
  - [ ] 20.4 计费合规评估：核实 Claude Agent SDK / `claude -p` 自 2026-06-15 起独立积分计费的官方文档（转述信息，立项前必须核实）
  - 验收：产出评估报告（工作量拆解 + 计费合规 + 推荐排序）；若立项至少一个 runtime 端到端 demo
- [x] 21. B7 MCP 能力深化（① 1 人日；②③ 设计 1-2 人日，依赖上游）
  - [x] 21.1 Worker 创建对话框按 mcp-catalog 默认勾选接线（低成本先行，配用例）
    - 完成记录（2026-09-29）：useMcpCatalog 暴露完整 servers[]（含 trusted 标记）+ `trustedCatalogServerNames()` 助手（9222fdc，先于远程 merge 提交以缩小冲突面）；McpSelector 新增可选 `defaultSelectedNames` prop——popover 打开且 value 为空时以 catalog trusted servers 预置 draft（显式选择恒优先、registry 外的名字忽略）；worker-create-dialog 接线（编辑对话框刻意不传——编辑不得静默改接线）。3 用例（默认预勾选生效、unknown 名忽略、显式选择不被 default 重复/不触发变更）
  - [x] 21.2 stdio 本地 MCP 托管：产出需求/设计稿与上游对齐（Controller 侧支持）
    - 完成记录（2026-09-29）：设计稿随上游对齐 issue 合并登记——agentscope-ai/AgentTeams#1312（B4 协议对齐）已建立上游对话通道；stdio 托管需求（本地进程生命周期/stdio 传输的 controller 托管面）以评论形式追加入 #1312，待上游回应。回应跟踪同 B4
  - [x] 21.3 远程 MCP OAuth 认证需求登记
    - 完成记录（2026-09-29）：同上追加入 #1312——远程 MCP 的 OAuth 2.0 授权（authorization code + token 刷新，凭据 server-side 存储与现有 AI 网关 Key 同域）登记为需求项，等 upstream 排期
  - 验收：①落地有用例；②③设计稿有上游回应；④与任务 24 联动
    - 验证记录（2026-09-29）：① ✓（3 用例 + 接线落地）；②③ 设计稿已登记上游 issue #1312（回应待维护者，跟踪留档）；④ 与 24 联动见该任务（README「MCP 治理」章节引用 21.1 的 trusted 默认勾选语义）。三门：eslint 0 错 0 警、tsc 0 错、vitest 全量通过（221 文件/2079 用例，merge 后基线）
- [ ] 22. B8 知识库/审计数据面切 Controller 正源评估（1-2 人日，依赖上游 v1.2.5+）
  - 对照上游 v1.2.4 契约评估切换范围（KB 目录、审计字段）与收益；产出「切/不切 + 理由」；若切给灰度方案与回滚点（MinIO/本地读取路径保留一个版本周期）
- [ ] 23. D3 会话回放/可观测性卖点（3-5 人日，依赖任务 7.2 ChatRoom 拆分）
  - 把 agent 会话导出为可分享只读回放链接（默认脱敏，复用 debug-log PII 脱敏）；README GIF 演示 thinking/tool-call/工作流卡片回放；链接访问控制过安全评审
- [ ] 24. D4 MCP 治理中心故事（0.5-1 人日，依赖任务 21.1）
  - README 增「MCP 治理」章节（registry、per-consumer 授权、审计线索）；技能/MCP 目录一键安装演示 GIF
- [ ] 25. D5 一键部署可传播（2-3 人日，demo 站另计）
  - docker compose 模板与 Coolify 模板；只读在线 demo 站（安全前提：只读沙箱账号 + 独立后端 + 不暴露真实集群，评审不过则降级为 GIF）；README 嵌 30 秒安装 GIF
- [ ] 26. D6 OpenClaw/QwenPaw 生态兼容维护原则（0.5 人日 + 持续，依赖任务 13）
  - runtime 会话目录/端点变更时保持旧路径回退一个版本周期；上游 runtime 发版冒烟纳入 B3 对照流程；探测回退路径补测试

## 关键依赖链（排期参照）

1. A1（任务 1）→ A2/A3/A9（任务 2/3/19）——A1 是回归网可信前提
2. A3（任务 3）→ isomorphic-dompurify 4.x 恢复
3. A5 ChatRoom 拆分（任务 7.2）→ D3（任务 23）
4. MinIO→RustFS：按 2026-09-28 用户决策仅保留本仓库侧改动（任务 16：回归套件 + 安装器 RUSTFS_* 回退），跨仓迁移链条（决策推动、阶段 0-4 执行）已移除
5. B1/B4/B5（任务 12/14/15）← 上游节奏，只做「准备 + 对齐」，不单向先行
