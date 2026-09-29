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

## 提交约定

- 每个独立改动一个 commit（任务式开发：一个任务点一个 commit）。
- commit message 用 conventional 风格前缀（feat/fix/refactor/test/docs/chore + 作用域）。
- 涉及上游语义的合入，把字段/语义对照清单存档到 `.monkeycode/specs/`（先例：`dashboard-optimization/b1-upstream-alignment.md`）。
