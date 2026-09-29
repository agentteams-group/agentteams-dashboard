# 外部 coding agent runtime 接入评估（B6 / 任务 20）

> 评估性质：不承诺实现。产出 = 工作量拆解 + 计费合规核实 + 推荐排序。日期：2026-09-29。

## 候选

Claude Code（Agent SDK / `claude -p` headless）、Codex CLI（OpenAI）、opencode（开源，多模型）。

## 20.1 接入面：协议适配器（B4 前置）

统一接入面为「外部 agent 输出 → `org.agentteams.run` v1 块」的协议适配器（协议见 `docs/INTERFACES.md`「运行时块协议」）。各 runtime 只需一个 adapter 把自己的事件流映射为五类块（text/thinking/tool_call/confirmation/error）；Dashboard 端零改动（渲染、计数、确认卡均已就绪），未知版本/坏块自动回退文本启发式，增量接入安全。

## 20.2 工作量归属拆解

| 归属 | 工作项 | 量级 |
| --- | --- | --- |
| 上游 Controller | CRD `WorkerRuntime` 枚举扩展（如 `claude-code` / `codex` / `opencode`）、`agentconfig generator` 生成对应运行配置（镜像或 CLI 包装）、Matrix channel 插件（各 runtime 的流式输出 → Matrix 消息映射，qwenpaw channel 4605 行是全量参考，opencode 等可走轻量 generic 路径） | 每 runtime 3-8 人日（channel 为主） |
| Dashboard | `WorkerRuntime` 联合类型扩展 → `runtime-meta.ts`（徽标/描述）→ `runtime-options.ts`（可创建性）→ `runtime-section.tsx`（卡片/计数）→ 能力门控（KB 数据面等 QwenPaw 专属能力的 runtime 判定）→ per-runtime 会话收集器（诊断/回放用，问天 logs 采集器的 runtime 分支） | 每 runtime 0.5-1 人日（机械扩展，维护清单见 `docs/runtime-capabilities.md`） |

## 20.3 轻量替代路径（先行验证）

不走 runtime 接入的轻量方案：**外部 agent 输出经 A2UI 标记投递进 Matrix**。任何能产出文本的 agent（包括本地脚本包装的 `claude -p`）都可以把结果包成 `<!--a2ui:{...}-->` 或直接 Markdown 投入房间——Dashboard 现有渲染链（A2UI / workflow / thinking 前缀 / 纯文本）无需任何改动即可展示。该路径验证成本 ≈0，可作为「接入价值」的先导验证：若用户接受纯文本+A2UI 展示，完整 runtime 接入的优先级自然下降。

## 20.4 计费合规核实（2026-09-29 官方文档实读）

来源：code.claude.com「Agent SDK overview」与「Run Claude Code programmatically」（headless）页面。

任务书流传的「`claude -p` 自 2026-06-15 起独立积分计费」**未在官方文档找到对应表述**。可证实的官方口径：

1. **bare 模式（`--bare`，脚本/SDK 调用的推荐模式）不读取订阅登录（OAuth/系统钥匙串），必须设置 `ANTHROPIC_API_KEY`**——即 headless 集成的成本天然落在调用方的 API 账户上。
2. 明确政策：**未经批准，Anthropic 不允许第三方产品提供 claude.ai 登录或其速率限制**（含基于 Agent SDK 构建的 agent）——AgentTeams 若集成，必须走用户自备 API Key 模式，不能共享平台订阅。
3. 成本可观测：`--output-format json` 的响应含 `total_cost_usd` 与分模型成本拆分（客户端估算，可与实际账单有差）；`--continue/--resume` 会累计整段会话成本。
4. 品牌合规：第三方不得使用「Claude Code」命名或其视觉元素（可用「Claude Agent」或「Powered by Claude」）。

**结论**：无「独立积分」一说，但 API Key 强制 + 禁止共享订阅 = 集成的计费含义是「每个部署自带 Anthropic API Key、按 token 计费」。对 AgentTeams 的落点：与现有 AI 网关（Higress 路由模型别名、Key 服务端保存）的模型不同——Claude Key 是 per-部署 env 而非网关路由目标，计费归属清晰（用户自己付费）但需要新的凭据注入位。Codex CLI / opencode 同理走各自厂商 Key 或开源网关，无 Anthropic 特有合规项（品牌条款除外）。

## 推荐排序

1. **opencode（开源，优先验证）**：MIT/Apache 系开源、多模型、有 headless 模式；无 Anthropic 品牌与订阅合规项；作为第一个端到端 demo 的成本最低。
2. **Claude Code（`claude -p`，次选）**：能力最强（hooks/subagents/MCP），但受品牌条款 + API Key 强制 + 禁共享订阅三重约束；若立项，demo 需用户自备 Key。
3. **Codex CLI（观察）**：闭源程度与授权模式待核实（本次未读其官方条款），暂列观察位。
4. **轻量路径（A2UI 投递，随时可做）**：任何 runtime 接入立项前先跑一遍，作为价值验证与兜底。

## 立项判据

- 轻量路径验证后仍有强需求（用户要原生卡片/会话回放，而非纯文本）；
- 上游 Controller 有意愿扩展 CRD 枚举与 channel（依赖 B3 对照流程的对齐通道）；
- 计费模型被目标用户接受（自备 Key）。
