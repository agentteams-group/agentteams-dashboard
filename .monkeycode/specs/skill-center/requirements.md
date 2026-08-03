# 需求文档：技能中心（Skill Center）

## 概述

重构当前技能管理机制，构建统一的「技能中心」模块。技能中心作为集中化的技能仓库，支持自定义技能上传管理和 Nacos 注册中心对接，并将技能选择能力下沉到 Worker 创建流程中。

---

## 术语表

- **技能中心**：Dashboard 内的统一技能管理界面，以表格形式展示所有可用技能
- **自定义技能**：用户通过 ZIP 包上传到 MinIO 的技能
- **Nacos 技能**：从配置的 Nacos 注册中心拉取并展示的技能，标识来源为注册中心别名
- **技能同步**：将选定的技能文件写入 Worker 的专属工作空间目录

---

## 用户故事

### US-1: 技能中心表格展示

**作为** 系统管理员，**我希望** 在一个集中页面查看和管理所有技能，**以便** 快速了解可用技能并进行增删改查操作。

#### 验收标准

1. WHEN 用户打开技能中心页面，系统 SHALL 以表格形式展示所有可用技能
2. WHEN 技能来自 Nacos 注册中心，系统 SHALL 在表格中标识其来源为注册中心别名
3. WHEN 技能为用户上传，系统 SHALL 在表格中标识其类型为「自定义」
4. WHILE 技能列表加载中，系统 SHALL 显示加载状态指示器
5. IF 技能列表为空，系统 SHALL 显示空状态提示

---

### US-2: 自定义技能上传

**作为** 系统管理员，**我希望** 上传标准格式的技能包（ZIP）到技能中心，**以便** 创建专属技能供 Worker 使用。

#### 验收标准

1. WHEN 用户上传 ZIP 文件，系统 SHALL 验证文件包含有效的 SKILL.md（含 name 和 description 字段）
2. WHEN 上传成功，系统 SHALL 将技能文件写入 MinIO 的 skill bucket
3. WHEN MinIO 中不存在 skill bucket，系统 SHALL 自动创建名为 `skills` 的 bucket
4. WHEN 上传成功，系统 SHALL 在技能中心表格中立即显示新技能
5. IF 上传的技能名已存在，系统 SHALL 提示用户技能名冲突或覆盖确认
6. IF 技能包格式无效，系统 SHALL 返回明确的错误提示信息

---

### US-3: 自定义技能编辑

**作为** 系统管理员，**我希望** 编辑自定义技能的元信息（名称、描述），**以便** 修正技能信息。

#### 验收标准

1. WHEN 用户点击编辑按钮，系统 SHALL 展示编辑表单
2. WHEN 用户修改技能描述并保存，系统 SHALL 更新技能的元信息
3. WHEN 用户取消编辑，系统 SHALL 不保存任何更改
4. IF 技能来源为 Nacos，系统 SHALL 禁止编辑操作

---

### US-4: 自定义技能删除

**作为** 系统管理员，**我希望** 删除不再需要的自定义技能，**以便** 保持技能中心整洁。

#### 验收标准

1. WHEN 用户点击删除按钮，系统 SHALL 显示确认对话框
2. WHEN 用户确认删除，系统 SHALL 从 MinIO 中删除该技能的所有文件
3. WHEN 删除成功，系统 SHALL 从表格中移除该技能
4. IF 技能正在被某个 Worker 使用，系统 SHALL 提示风险但仍允许删除
5. IF 技能来源为 Nacos，系统 SHALL 禁止删除操作

---

### US-5: Nacos 注册中心对接

**作为** 系统管理员，**我希望** 配置 Nacos 注册中心 URL，系统 SHALL 自动拉取技能列表并在表格中展示，**以便** 复用已有的技能生态。

#### 验收标准

1. WHEN 用户在设置中配置 Nacos 注册中心 URL，系统 SHALL 保存该配置
2. WHEN 配置保存后，系统 SHALL 调用 Nacos API 拉取技能列表
3. WHEN 拉取成功，系统 SHALL 在技能中心表格中展示所有可用技能，标识来源为注册中心别名
4. WHEN Nacos 配置为空或 API 调用失败，系统 SHALL 降级为仅展示自定义技能
5. WHILE 技能列表加载中，系统 SHALL 显示加载状态指示器

---

### US-6: Worker 创建时选择技能

**作为** 系统管理员，**我希望** 在创建 Worker 时从技能中心选择技能，**以便** 为 Worker 配置所需能力。

#### 验收标准

1. WHEN 用户打开创建 Worker 对话框，系统 SHALL 提供技能选择界面
2. WHEN 用户在技能选择器中输入关键词，系统 SHALL 模糊匹配技能名称并展示结果
3. WHEN 用户选择多个技能，系统 SHALL 以多选形式展示已选技能
4. WHEN 用户提交创建请求，系统 SHALL 将选定的技能同步到 Worker 的工作空间
5. WHEN 技能同步完成，系统 SHALL 在创建工作空间中记录技能元信息

---

### US-7: 技能同步到 Worker 工作空间

**作为** 系统管理员，**我希望** 选定的技能能够自动同步到 Worker 的专属工作空间，**以便** Worker 在运行时能够使用这些技能。

#### 验收标准

1. WHEN 用户选择技能并提交 Worker 创建，系统 SHALL 将技能文件从技能中心复制到 Worker 工作空间
2. WHEN 技能文件复制完成，系统 SHALL 验证文件完整性
3. IF 技能同步失败，系统 SHALL 回滚 Worker 创建操作或标记部分失败状态
4. WHEN 同步成功，系统 SHALL 返回确认信息包含同步的技能列表

---

## 非功能性需求

### NFR-1: 性能

- 技能列表加载响应时间 SHALL 不超过 2 秒（100 个技能以内）
- 技能上传 SHALL 支持最大 64 MB 的 ZIP 文件

### NFR-2: 可靠性

- 技能上传过程 SHALL 支持断点续传或失败重试
- 技能删除 SHALL 提供二次确认防止误操作

### NFR-3: 兼容性

- 自定义技能格式 SHALL 兼容现有 `SKILL.md` 规范（含 name 和 description frontmatter）
- Nacos 技能列表 SHALL 兼容 AgentTeams 标准技能元数据格式

---

## 相关接口

| 接口 | 方法 | 描述 |
|------|------|------|
| `/api/agentteams/skills` | GET | 获取技能中心列表（含 Nacos） |
| `/api/agentteams/skills` | POST | 上传自定义技能包 |
| `/api/agentteams/skills/:name` | DELETE | 删除自定义技能 |
| `/api/agentteams/skills/:name` | PUT | 更新自定义技能元信息 |
| `/api/agentteams/skills/nacos/config` | GET | 获取 Nacos 配置 |
| `/api/agentteams/skills/nacos/config` | PUT | 更新 Nacos 配置 |
| `/api/agentteams/skills/nacos/sync` | POST | 手动触发 Nacos 技能同步 |

---

## 数据模型

### 技能元信息

```typescript
interface SkillEntry {
  name: string;              // 技能唯一标识
  description: string;       // 技能描述
  source: 'custom' | 'nacos'; // 来源类型
  sourceAlias?: string;      // Nacos 注册中心别名（source='nacos' 时）
  version?: string;          // 技能版本
  createdAt: string;         // 创建时间
  updatedAt: string;         // 更新时间
  fileCount: number;         // 包含的文件数量
}
```

### Nacos 配置

```typescript
interface NacosConfig {
  registryUrl: string;       // Nacos 注册中心 URL
  namespace: string;         // Nacos 命名空间
  username?: string;         // Nacos 用户名（可选）
  password?: string;         // Nacos 密码（可选）
}
```

---

## 依赖关系

- 本功能依赖现有的 MinIO 集成（`src/lib/minio-client.ts`）
- 本功能依赖现有的技能包解析逻辑（`src/lib/skill-package.ts`）
- Worker 创建流程 SHALL 扩展以支持技能选择

---

## 开放问题（已解决）

1. Nacos 同步频率：**两者都支持** —— 支持手动触发同步，也支持定时自动刷新（首次加载 + 定时轮询）。
2. 技能名称冲突：**询问用户** —— 上传同名技能时提示用户选择覆盖或取消。
3. Worker 技能同步：**Controller 负责** —— Dashboard 仅记录 Worker 与技能的关联关系，实际文件同步由 AgentTeams Controller 完成。
