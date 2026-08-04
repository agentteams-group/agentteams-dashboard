# 需求文档: 修复模型别名绑定与路由自动接入逻辑

## 需求 NR-001: 空映射时不自动创建 AI 路由

### Scenario NR-001-1: 新增提供商无模型映射
**WHEN** 用户在模型管理页面新建提供商且未配置任何模型映射  
**THEN** 系统 SHALL 不自动创建 AI 路由  
**AND** 绑定表中不应出现该提供商的任何别名绑定

### Scenario NR-001-2: 新增提供商有模型映射
**WHEN** 用户在模型管理页面新建提供商且配置了模型映射（如 `test-qwen3.6 → qwen3.6-plus`）  
**THEN** 系统 SHALL 自动创建对应的 AI 路由，路由须携带精确的模型匹配条件（modelPredicates 包含对应别名）  
**AND** 绑定表 SHALL 显示新映射关系为"可用"

## 需求 NR-002: 绑定表展示准确性

### Scenario NR-002-1: 绑定表枚举完整映射键
**WHEN** 系统显示模型别名绑定表  
**THEN** 绑定表 SHALL 同时枚举以下来源：
- 当前 Manager/Worker 正在使用的别名
- 路由和供应商中显式配置的映射键
- 路由的精确模型匹配条件

### Scenario NR-002-2: 透传关系明确标记
**WHEN** 某别名通过路由的空 modelMapping 或空 modelPredicates 实现原样透传  
**THEN** 绑定表 SHALL 标记该绑定为"透传"状态，不标记为"可用"

### Scenario NR-002-3: 路由冲突检测
**WHEN** 同一模型别名命中多条路由  
**THEN** 绑定表 SHALL 显示"路由冲突"标识，不将多条路由同时标记为"可用"

## 需求 NR-003: 下拉框归属正确

### Scenario NR-003-1: Worker 模型下拉框归属
**WHEN** 用户查看 Worker 模型下拉框中某个别名  
**THEN** 归属描述 SHALL 指向正确的路由和提供商（如 `agentteams-test / test / qwen3.6-plus`），而非错误地指向默认路由

## 需求 NR-004: 重复绑定消除

### Scenario NR-004-1: Worker 切换模型后绑定唯一
**WHEN** Worker 切换到新模型别名（如 `test-qwen3.6`）  
**THEN** 绑定表 SHALL 只出现一条指向正确路由的绑定，不出现重复行
