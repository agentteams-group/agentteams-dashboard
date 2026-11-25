# 参与开发（CONTRIBUTING）

## 开发环境

```bash
# 首次克隆与每次拉取后
npm ci --no-audit --no-fund --legacy-peer-deps
npm run dev
```

要求 Node.js 22+。开发规范见 `docs/DEVELOPER_GUIDE.md`。

## 每次改动必过「三门」

1. `npm run typecheck`（tsc --noEmit，`noImplicitAny: true` 完整 strict 语义）
2. `npm run lint`（eslint，0 警告基线）
3. `npm test`（vitest 全量）

三项全绿再提交。注意：vitest 用 esbuild 转译、运行时不做类型检查——新测试文件只有 tsc 能暴露类型错误，务必三门同跑。

`npm run lint` 里除 eslint 还跑一道排版门禁（`scripts/typography-scan.mjs`，也可单独 `npm run lint:typography`）：界面字号只允许三档——标题 `text-sm font-semibold`、正文 `text-sm`、元信息 `text-xs`，不准写 `text-[10px]` 这类任意值。理由是这台机器的企业主题用 `fontSize` 改根字号（`src/lib/theme/apply.ts`），px 写死的字不跟着缩放，放大字号的用户会看到别的都变大、只有那块不变；三套主题下逐处写死的小字号也没人能一次改全。

可点面五态（悬停 / 按下 / 键盘聚焦 / 禁用 / 正在忙）走 `src/lib/interaction-states.ts` 里同一份配方，别在组件里手写 `hover:bg-accent transition-colors`：`Button` 基元已带齐五态；行和块用 `INTERACTIVE_SURFACE_CLASS`（选中态自带底色的用 `INTERACTIVE_STATES_CLASS`，否则通用悬停底色会跟选中底色打架，谁赢取决于样式表顺序）；卡片用 `INTERACTIVE_CARD_CLASS`（`glass-card` 的底是毛玻璃，卡片的反馈只能放在位移和边框上）。`div` 装按钮的地方一律 `role="button"` + `tabIndex={0}` + `onKeyDown={handleActivate(onClick)}`（空格要 `preventDefault`，否则页面先滚一段），没有 `onClick` 的卡片就别给它按钮语义。运行状态色同理：阶段名 → 颜色只在 `src/lib/status-tokens.ts`（`PHASE_STATUS_TOKEN` 加 `statusBadgeClass` / `statusTextClass` / `statusDotClass`）一处，组件里不再自带 `PHASE_COLOR` 表——三套主题加高对比逐处写死是修不完的。

## AI 协作痕迹约定

涉及 AI 生成或 AI 辅助修改的文案（README、docs、UI 文案），提交前过一遍语调门禁：

```bash
npm run lint:tone
```

门禁扫描 AI 常见的夸大/套话表达（`scripts/ai-tone-scan.mjs`）；命中项改写为平实陈述后再提交。

## 上游对齐流程（B3）

本仓依赖上游 `agentscope-ai/AgentTeams`（安装器、Controller API 契约）。上游 minor 版本发布后：

1. **过一遍 proxy 层端点**：`src/app/api/agentteams` 下的 `route.ts`（当前 84 个，其中 43 个经 `proxyToAgentTeams` 代理 `api/v1/*`）。提取方式：

   ```bash
   grep -rn "api/v1/" src/app/api/agentteams --include="*.ts" | grep -v test | grep -oE "/api/v1/[^\`'\"]+"
   ```

   对照上游 changelog 与 controller 代码，确认请求/响应字段、分页参数、错误码未漂移；变化点更新到 `docs/INTERFACES.md` 的「上游版本对照记录」。

2. **安装器漂移**：weekly cron（`.github/workflows/upstream-drift.yml`）自动 diff 上游安装器并超阈值开 issue；本地也可手动比对 `install/agentteams-install.sh`。

3. **安装器改动走上游**：本仓安装器是上游工作副本，dashboard 集成改动直接向 `agentscope-ai/AgentTeams` 提 PR（见 `install/AGENTTEAMS_PATCH.md`），不长期驻留本仓分支。

4. **runtime 生态兼容**：会话目录/端点变更保持旧路径回退一个版本周期；上游 runtime 发版冒烟按第 1 步流程执行。原则全文见 `docs/runtime-capabilities.md`「生态兼容维护原则」。

## 提交约定

- 每个独立改动一个 commit（任务式开发：一个任务点一个 commit）。
- commit message 用 conventional 风格前缀（feat/fix/refactor/test/docs/chore + 作用域）。
- 涉及上游语义的合入，把字段/语义对照清单存档到 `.monkeycode/specs/`（先例：`dashboard-optimization/b1-upstream-alignment.md`）。
