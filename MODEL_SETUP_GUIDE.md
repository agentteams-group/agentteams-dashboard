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
- **网关路径前缀**：AI 网关路由匹配路径，默认 `/v1`。百炼 DashScope 如使用 `/compatible-mode/v1` 路径，可在此修改
- **自定义 Base URL**：仅 `openai`/`ollama`/`vllm`/`openrouter` 四类显示此字段
- **Token 故障转移**：当一个 Token 连续失败 N 次后自动切换到下一个 Token
- **测试连通性**：填入 API Key 后点击按钮，直接向提供商 API 发送探测请求，验证 Key 和端点是否可用

### 常见配置示例

#### DeepSeek 官方
```
类型: deepseek
协议: openai/v1
API Key: sk-从DeepSeek官网获取
模型映射: team-chat -> deepseek-chat
```

#### 火山引擎 DeepSeek
```
类型: 字节豆包
协议: openai/v1
API Key: 从火山引擎方舟平台获取的 ARK API Key
模型映射: team-chat -> deepseek-v3-250324
```
火山引擎与豆包共享 ARK API 基础设施，内置端点为 `https://ark.cn-beijing.volces.com/api/v3`。

#### 百炼 DeepSeek
```
类型: 通义千问 (Qwen)
协议: openai/v1
API Key: 从阿里云百炼控制台获取的 DashScope API Key
模型映射: team-chat -> deepseek-r1
```
百炼与通义千问共享 DashScope API 基础设施，内置端点为 `https://dashscope.aliyuncs.com/compatible-mode/v1`。

> 如果内置端点不可用，可改用 `openai` 类型 + 自定义 Base URL：
> - 火山引擎：Base URL 填 `https://ark.cn-beijing.volces.com/api/v3`
> - 百炼：Base URL 填 `https://dashscope.aliyuncs.com/compatible-mode/v1`

---

## 第二步：检查 AI 路由（自动或手动创建）

### 自动创建（推荐）

创建 Provider 时如果填写了模型映射，系统会自动创建路由 `agentteams-{provider名称}`，使用表单中配置的**网关路径前缀**（默认 `/v1`）。

### 手动创建

如果自动创建失败，或需要多个 Provider 做负载均衡，在 "AI 路由" 卡片手动创建。

---

## 第三步：创建 Consumer（API 认证凭证）

点击 "添加 Consumer"，输入名称，API Key 留空自动生成。

**重要**：API Key 仅在当前页面显示一次，必须立即复制保存。

---

## 第四步：在 Worker/Manager 中选择模型

进入 Worker 创建/编辑面板，在 "请求模型别名" 下拉中即可看到配置的模型别名。

---

## 常见问题

### Q: 创建 Provider 后 Worker 下拉仍看不到模型？

检查 AI 路由 modelPredicates 是否匹配你的别名，以及 Consumer 是否已创建。

### Q: Worker 调用模型返回 401？

Consumer 凭证未正确传递或被删除。重新创建 Consumer。

### Q: 路径前缀应该填什么？

通常保持默认 `/v1`。如果提供商 API 使用特殊路径前缀（如百炼 `/compatible-mode/v1`），修改此字段使网关路由能正确匹配 Worker 发出的请求。

### Q: 测试连通性按钮有什么用？

在创建提供商之前验证 API Key 和端点的可用性。直连提供商 API，不经过网关，能快速定位 Key 错误或网络不通的问题。
