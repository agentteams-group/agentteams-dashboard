# 技术设计: 修复模型别名绑定与路由自动接入逻辑

## 概述

Dashboard 模型管理页面存在多处 Bug，根源是自动生成的供应商路由缺少精确的模型匹配条件，导致与默认路由冲突，引发绑定表展示错误和实际请求路由歧义。

## 根因分析

三个 Bug 源于同一根因：`model-bindings.ts` 中 `routeMatchesAlias` 函数在 `predicates.length === 0` 时返回 `true`（匹配所有别名），而 `autoWireProviderRoute` 在空映射时仍创建路由。

## 决策

**采用方案 A**: 空映射时不自动创建路由 + 增强绑定表冲突检测

## 实现位置

- `src/lib/model-bindings.ts` — 绑定计算核心逻辑
- `src/lib/model-catalog.ts` — 模型目录构建
- `src/components/dashboard/sections/models-section.tsx` — 模型管理 UI

## 详细设计

### 1. 修改 `models-section.tsx` — `autoWireProviderRoute`

当 `form.modelMappings.length === 0` 时，跳过路由创建，仅提示用户手动创建路由。

### 2. 修改 `model-bindings.ts` — 增强冲突检测

新增字段到 `AgentTeamsModelBinding`:
- `conflict?: boolean` — 同一别名命中多条路由时为 true
- `passthrough?: boolean` — 透传绑定标记

冲突检测逻辑:
- 按别名分组所有绑定
- 同一别名命中多条不同路由时标记 `conflict: true`
- 透传绑定标记 `passthrough: true`

### 3. 修改 `model-catalog.ts` — 修复下拉框归属

当别名存在冲突绑定时，归属描述列出所有匹配路由并标记冲突。

### 4. 修改 `models-section.tsx` — 绑定表展示

新增徽章:
- `conflict: true` → 红色"冲突"徽章
- `passthrough: true` → 黄色"透传"徽章

## 测试计划

### 单元测试
1. `model-bindings.test.ts`: 冲突检测、透传标记、多路由同一别名
2. `model-catalog.test.ts`: 下拉框归属正确性

### 集成测试
1. `models-section.test.tsx`: 无映射不自动创建路由、有映射自动创建路由、冲突展示

## 验收标准

- **条件A**: 新增供应商不配置模型映射 → 不自动创建路由，绑定表无别名
- **条件B**: 配置模型映射后 → 绑定表正确显示，原有绑定按预期消失
- **条件C**: Worker 切换模型后 → 绑定表只出现一条指向正确路由的绑定
- **条件D**: TypeScript 编译通过，ESLint 无新增错误，测试全绿