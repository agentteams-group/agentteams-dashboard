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

- [ ] 9. A7 Windows 开发脚本与依赖同步防脱节（0.5-1 人日，P1）
  - [ ] 9.1 `package.json` dev/start 脚本去 Unix-only 语法（cross-env 或 node 包装脚本去 env 前缀）
  - [ ] 9.2 日志 tee 管道改 node 脚本封装（或去掉管道、CI 侧收集）
  - [ ] 9.3 README 开发准备节明确「首次/拉取后先 `npm ci --no-audit --no-fund --legacy-peer-deps`」
  - 验收：Windows cmd 与 Linux 下 `npm run dev` / `npm run start` 均可直接运行；新人按 README 一次跑通三门

- [ ] 10. A8 覆盖率范围扩大到安全关键模块（2-4 人日，渐进；容量超限可顺延 P2 前段）
  - [ ] 10.1 补关键路径单测：rbac-engine（deny 优先语义）、audit-log（轮转）、minio-client、skill-center-storage（bucket 前缀与敏感文件判断）、homeserver-allowlist
  - [ ] 10.2 上述模块渐进加入 `vitest.config.ts:31-38` coverage include，阈值逐步抬升
  - 验收：coverage 报告含上述模块；新增单测全绿；全量测试耗时增幅 <10%

### 上游线

- [ ] 11. B2 Runtime 展示与门控内部一致性收尾（1-2 人日，P1，零上游依赖可立即做；排期避开发版窗口）
  - [ ] 11.1 补 deepseek-harness 卡片与计数（`runtime-section.tsx:16-60` 仅 5 张卡片、`:80` 计数 5 种）
  - [ ] 11.2 KB/workspace-files 面 Worker 下拉按 runtime 过滤，或 UI 明示「QwenPaw 专属」及原因（`docs/code-review-issues.md:164`）
  - [ ] 11.3 以 `.monkeycode/specs/worker-card-v2-chat-runtime-ux/task-book.md` §4.1 能力对照表为底稿，沉淀正式 runtime 能力表（docs/ 新文档或内嵌），替换 QwenPaw 卡片过时的 models 宣传
  - [ ] 11.4 deepseek-harness 卡片加「实验」徽标
  - 验收：卡片数与可创建 runtime 数一致（4 可建 + legacy 口径明确）；选非 qwenpaw runtime 时 KB 面给出明确禁用原因；能力表评审合入

- [ ] 12. B1 跟进上游 PR #1306，合入本地 worker env 编辑实现（1-2 人日，依赖上游落定）
  - [ ] 12.1 跟踪 #1306（Worker env 编辑 + gateway 身份探测）落定；diff 本地 `codex/worker-config-gateway`（b1c34f8）与上游语义（env 字段集、gateway-probe 请求/响应、错误语义）
  - [ ] 12.2 按上游为准调整后合入 main，对照清单留档到 spec
  - [ ] 12.3 为 `/api/agentteams/workers/[name]/gateway-probe` 补端到端用例
  - 验收：main 含与上游语义一致的能力；无字段漂移（清单存档）；三门绿

- [ ] 13. B3 上游对齐自动化：install.sh 漂移检测 + Controller 契约对照（1-1.5 人日，P1）
  - [ ] 13.1 CI 增加 weekly cron：拉取上游安装器与本仓 `install/agentteams-install.sh`（4707 行）diff，超阈值（>50 行或命中 step_dashboard 段）开 issue 告警
  - [ ] 13.2 `docs/INTERFACES.md` 建立「上游版本对照记录」小节，先落 v1.2.4 对照（events 分页、审计字段等）
  - [ ] 13.3 形成流程：上游 minor 发布后过一遍 proxy 层端点（`src/app/api/agentteams` 112 个 route 的目标端点清单）；流程写入 CONTRIBUTING（与任务 18 协同）
  - 验收：cron job 上线且首次产出 diff 报告；INTERFACES.md 含 v1.2.4 对照记录

- [ ] 14. B4 org.agentteams.run v1 协议固化（1-2 人日，P1）
  - [ ] 14.1 v1 块协议写入 `docs/INTERFACES.md` 新章节（块类型 union：text/thinking/tool_call/confirmation/error、字段规范、版本协商、未知版本回退语义）
  - [ ] 14.2 向上游提 PR/issue 对齐并跟踪回应
  - [ ] 14.3 保持 normalize.ts 既有启发式为兜底；协议解析测试覆盖未知版本回退路径
  - 验收：INTERFACES.md 含协议章节；上游侧有回应；回退路径测试绿

- [ ] 15. B5 QwenPaw 迁移收口与上游兼容窗口对齐（0.5-1 人日本体，时点依赖上游 minor 窗口）
  - [ ] 15.1 与上游约定存量 CoPaw 清理时点（建议跟下一个 minor）；`WorkerRuntime` 的 `'copaw'` 保留至清理时点
  - [ ] 15.2 明确「升级态」实例迁移引导；存量 CoPaw「一键升级 QwenPaw」路径冒烟通过
  - [ ] 15.3 梳理 `.copaw` 会话目录回退探测（qwenpaw 优先 + copaw 回退）的退役计划并成文
  - 验收：CHANGELOG/文档明确清理时点；冒烟通过；退役计划成文

### 存储与 DX 线

- [ ] 16. 存储面回归套件 + 安装器 RUSTFS_* 凭证回退（1.5-2.5 人日，P1；仅本仓库侧，原 C1 裁剪版）
  - [ ] 16.1 按 design.md 3.3.4 清单编写可重复执行的回归（vitest 集成测试 + 手动冒烟脚本）：64MB 技能 ZIP 上传、presign GET/PUT 链路（15 分钟过期 + 敏感文件拒签 404）、storage 全树（9 route）错误码、skills 三来源、team-tasks/teams/workers files 读写、并发 listObjects、健康面板探测、MCP 配置 CRUD
  - [ ] 16.2 对现网 MinIO 跑通作为基线（作为存储面通用回归覆盖，后续任一 S3 后端可重跑比对）
  - [ ] 16.3 给 `install/agentteams-dashboard.sh` 的凭证探测链追加 RUSTFS_* 命名空间回退（现有 `AGENTTEAMS_FS_*` → `AGENTTEAMS_MINIO_*` 之后兜底 RUSTFS_* 变量名），并在 `install/agentteams-dashboard-tests.sh` 补探测链用例
  - 验收：回归套件在现网 MinIO 全绿；安装器探测链更新且有测试覆盖

- [ ] 17. D1 贡献者入口基线（2-3 人日，P1，依赖任务 6 的死链检查）
  - [ ] 17.1 新增 CONTRIBUTING.md：三门验证顺序（typecheck→eslint→vitest）、`npm ci` 同步约定、AI 协作痕迹约定（`lint:tone` 门禁）、上游对齐流程（引用 `install/AGENTTEAMS_PATCH.md`）
  - [ ] 17.2 补 issue（bug/feature）与 PR 模板（`.github/ISSUE_TEMPLATE/`、`PULL_REQUEST_TEMPLATE.md`）
  - [ ] 17.3 修复 README.md:331 死链（与任务 6 协同，避免重复改）
  - [ ] 17.4 插件 gallery 页 MVP（内置 wen-tian/monitor-panel 之外给外部插件曝光位）
  - 验收：CONTRIBUTING/模板合入；死链检查覆盖新文档；gallery MVP 可浏览已注册插件

- [ ] 18. D2「Mission Control」定位与 README 改版（1-2 人日，P1；录制/截图另计）
  - [ ] 18.1 双语 README（README.md / README.zh-CN.md）首屏配大图/GIF（overview 拓扑 + 任务看板干预 + Chat 回放三连）
  - [ ] 18.2 定位文案从「管理面板」升级为「多智能体团队 Mission Control」
  - [ ] 18.3 一次对外发布（release notes/社区帖）使用该定位
  - 验收：双语首屏含演示图与定位语；一次对外发布落地

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
- [ ] 21. B7 MCP 能力深化（① 1 人日；②③ 设计 1-2 人日，依赖上游）
  - [ ] 21.1 Worker 创建对话框按 mcp-catalog 默认勾选接线（低成本先行，配用例）
  - [ ] 21.2 stdio 本地 MCP 托管：产出需求/设计稿与上游对齐（Controller 侧支持）
  - [ ] 21.3 远程 MCP OAuth 认证需求登记
  - 验收：①落地有用例；②③设计稿有上游回应；④与任务 24 联动
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
