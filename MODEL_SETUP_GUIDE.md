# 模型配置：从零到跑通完整教程

## 概述

AgentTeams 通过 **Higress AI 网关** 管理所有对大语言模型的访问。Worker 和 Manager 不直接持有 API Key，而是通过 Consumer 凭证经网关代理访问模型。配置流程分四步：

```
创建 Provider --> 创建 AI Route --> 创建 Consumer --> Worker 选择模型
```

---

## 第一步：创建 AI 提供商 (Provider)

### 操作路径

面板 / AI 模型 / "AI 模型提供商"卡片 / "添加提供商"按钮

### 必填字段

| 字段 | 说明 | 示例 |
|------|------|------|
| 名称 | 唯一标识，仅字母/数字/连字符 | `my-deepseek` |
| 类型 | 提供商类型，下拉选择 | `deepseek`（共 29 种可选） |
| API Key | 实际的 API 密钥，多个用逗号分隔 | `sk-xxxx,yyyy` |
| 模型映射 | 请求模型 -> 目标模型的别名映射 | `team-chat` -> `deepseek-chat` |

### 可选字段

- **协议**：`openai/v1`（默认，绝大多数提供商兼容）或 `original`
- **自定义 Base URL**：仅 openai/ollama/vllm/openrouter 四类显示此字段，用于指向代理或私服地址
- **Token 故障转移**：当一个 Token 连续失败 N 次后自动切换到下一个 Token

### 操作示例

```
名称: deepseek-provider
类型: deepseek
协议: openai/v1
API Key: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
模型映射:
  请求模型: team-chat    目标模型: deepseek-chat
  请求模型: team-reasoner 目标模型: deepseek-reasoner
```

**点击"创建提供商"后**，系统会自动生成一条 AI 路由，将你配置的模型映射接入网关。提示 "已自动创建路由" 即表示成功。

---

## 第二步：检查 AI 路由（自动或手动创建）

### 自动创建（推荐）

创建 Provider 时如果填写了模型映射，系统会自动创建路由 `agentteams-{provider名称}`，无需手动操作。

### 手动创建（当需要自定义路由时）

如果自动创建失败，或你需要多个 Provider 做负载均衡/故障转移，在 "AI 路由" 卡片点击 "创建 AI 路由"。

| 字段 | 说明 |
|------|------|
| 路由名称 | 唯一标识 |
| 路径匹配 | 固定 `/v1` （OpenAI 兼容路径前缀） |
| 上游提供商 | 选择 Provider 并设权重（100 为独占） |
| 请求模型匹配 | 精确匹配别名，如 `team-chat` |
| 启用认证 | 必须开启（Consumer 凭证认证） |

---

## 第三步：创建 Consumer（API 认证凭证）

Worker 通过 Consumer 凭证认证后才能调用 AI 路由。在 "Consumers" 区域操作。

### 操作

点击 "添加 Consumer"，输入名称（如 `worker-consumer`），API Key 可留空自动生成。

**重要**：创建成功后，API Key **仅在当前页面显示一次**，必须立即复制保存。

创建后 Consumer 会自动绑定到所有 AI 路由，无需手动操作。

---

## 第四步：在 Worker/Manager 中选择模型

配置完以上三步后，进入 Worker 创建/编辑面板，在 "请求模型别名" 下拉中即可看到你配置的模型别名（如 `team-chat`）。

### 模型别名的三种状态

| 状态 | 含义 | 选择后能否工作 |
|------|------|---------------|
| 已配置 (configured) | 已有 AI 路由指向该别名 | 可以，直接使用 |
| 内置 (builtin) | 系统中预定义的别名，但尚无路由 | 需要先按上述步骤配置路由 |
| 冲突 | 多个路由匹配同一别名 | 不建议选择，需修复路由冲突 |

---

## 完整示例：用 DeepSeek 跑通

### 1. 创建 Provider

```
名称: deepseek
类型: deepseek
API Key: sk-你的deepseek密钥
模型映射:
  team-chat -> deepseek-chat
```

### 2. 创建 Consumer

```
名称: my-consumer
API Key: 留空自动生成
```

复制生成的 API Key 妥善保存。

### 3. 创建 Worker

```
名称: test-worker
运行时: OpenClaw
请求模型别名: team-chat（下拉框中可见）
```

Worker 创建后即可通过 AI 网关访问 DeepSeek 模型。

---

## 常见问题

### Q: 创建 Provider 后 Worker 下拉仍看不到模型？

检查：
1. AI 路由是否已创建（查看 "请求模型别名绑定" 表，确认 alias 状态为"可用"）
2. 模型映射中的 "请求模型" 值是否与 Worker 表单中的下拉选项一致
3. Consumer 是否已创建并绑定

### Q: Worker 调用模型返回 401？

Consumer 凭证未正确传递或被删除。重新创建 Consumer 获取新 Key。

### Q: 想用多个模型提供商做负载均衡？

在 AI 路由中添加多个上游 Provider，各设不同权重。例如 deepseek 权重 70、qwen 权重 30。

### Q: API Key 轮换如何操作？

编辑 Provider，在 "新增 Token" 字段输入新 Key（多 Key 用逗号分隔）。开启 Token 故障转移实现自动切换。
