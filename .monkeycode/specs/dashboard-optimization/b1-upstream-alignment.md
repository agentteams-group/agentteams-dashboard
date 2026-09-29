# B1 上游对齐对照清单：Worker env 编辑 + gateway 身份探测

> 任务 12（B1）。上游 PR 实际编号为 **agentteams-dashboard#135**（任务书的 "#1306" 为编号笔误——dashboard 与 controller 两仓库的 #1306 均不存在，2026-09-29 带凭据 API 复核）。

## 上游状态跟踪（12.1）

| 项 | 值 |
| --- | --- |
| PR | agentteams-group/agentteams-dashboard#135 |
| 标题 | feat: complete Worker environment editing and gateway access verification flow |
| 状态（2026-09-29 复核） | open，created/updated 2026-09-21，无后续评审动静 |
| head | `codex/worker-config-gateway` @ `b1c34f8`（与任务书所指 commit 一致——本地分支即 PR head，**本地与上游语义零漂移**） |
| 可合并性 | `mergeable_state: dirty`（base main 已被 A5-A8/B2 演进，PR 未更新） |

## 合入方式（12.2）

`git cherry-pick b1c34f8`（2026-09-29，本仓库 commit `00e004b`）。20 文件中 19 个自动合并；唯一冲突 `workers-section.tsx` 的保存 handler：main 侧 CoPaw 存量校验（`isLegacyCopaw` 拒改）与分支侧 env 清理（`!envChanged → delete data.env`）为正交逻辑，两者并留。

## 字段/语义对照清单

| 面 | 语义 | 落点 |
| --- | --- | --- |
| env 写入门 | body 含 `env` 键且会话等级 ≠ 3 → 403「环境变量仅允许管理员修改」（`rejectEnvironmentWrite`，PUT 单体与列表批量均过） | `workers/environment-access.ts` |
| env 读过滤 | 非 L3 会话的 worker 响应剥除 `env` 并置 `envEditable: false`（防部署级 Controller 凭据把低权读变成密钥泄露；单体与列表两个 GET 都过 `filterEnvironmentResponse`） | 同上 |
| gateway-probe | `POST /api/agentteams/workers/[name]/gateway-probe` → RBAC `update` × `gateway.consumer` × name → 代理 controller `/api/v1/workers/{name}/gateway-probe`（错误语义原样透传） | `workers/[name]/gateway-probe/route.ts` |
| worker 更新体 | `env` 以字面量 key/value 传 controller；未变更时整体省略 `env` 键（不触发托管容器重建）；UI 保存成功提示托管容器重建 / 非托管进程需手动更新 | `workers-section.tsx` 保存 handler + `worker-env-editor.tsx` |
| `envEditable` | API 类型新增字段（`agentteams-api.ts`），UI 依此决定 env 编辑器是否呈现 | `worker-edit-dialog.tsx` |
| 模型选择联动 | mcp-selector / model-selector / models-section / mcp-server-dialog 跟进 env 编辑流程的最小适配（测试同步） | 各组件 |
| RBAC 面常量 | `gateway.consumer` 为新增 resourceType 字面量（与 controller 契约对齐） | gateway-probe 路由 |

## 与上游复核要点（PR 落定/更新时）

1. PR 若 rebase/改写 head（headSha ≠ b1c34f8）：diff 新 head 与本清单，重点核对上表 7 项语义与错误码。
2. `rejectEnvironmentWrite` 的「含 env 键即管理员」判定是否扩展到嵌套/别名键。
3. `filterEnvironmentResponse` 对非 JSON 上游体的行为（当前原样放行）。
4. gateway-probe 的 controller 侧请求/响应契约字段（当前纯透传，Dashboard 无自身字段）。

## 验证

- `gateway-probe/route.test.ts`（12.3，4 用例：RBAC 拒绝短路不触代理、放行时 level 参数与代理路径/方法正确、名字 URL 编码、上游错误透传）
- 分支自带测试随 cherry-pick 进入：environment-access.test.ts（21 行）、worker-env-editor.test.tsx、worker-gateway-probe.test.tsx、mcp-selector/models-section 测试扩充
- 三门（2026-09-29）：eslint 0 错 0 警；tsc 0 错；vitest 全量绿（数字见提交时运行记录）
