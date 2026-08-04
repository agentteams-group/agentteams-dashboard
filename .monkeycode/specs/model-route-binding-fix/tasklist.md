# 任务清单: 修复模型别名绑定与路由自动接入逻辑

## TASK-001: 修复 model-bindings.ts 冲突检测与透传标记

- [x] 扩展 `AgentTeamsModelBinding` 接口，新增 `conflict?: boolean` 和 `passthrough?: boolean` 字段
- [x] 在 `buildModelBindings` 中实现冲突检测逻辑
- [x] 新增测试用例验证冲突检测和透传标记
- [x] 运行 `npm run typecheck` 确认无类型错误
- [x] 运行 `npm test -- model-bindings` 确认测试通过
- [x] 修复 `collectAllAliases` 枚举逻辑以包含配置映射键
- [x] 修复 passthrough available 语义 (commit e41be5d)
- [x] 添加精确场景测试 (commit 850923e)

## TASK-002: 修复 model-catalog.ts 下拉框归属

- [x] 修改 `buildModelSelectionOptions` 处理冲突绑定
- [x] 更新 `ModelSelectionOption` 接口
- [x] 新增测试用例验证下拉框归属正确性
- [x] 运行 `npm test -- model-catalog` 确认测试通过

## TASK-003: 修复 models-section.tsx 自动路由创建逻辑

- [x] 修改 `autoWireProviderRoute`，空映射时跳过路由创建
- [x] 修改绑定表 UI，新增冲突和透传徽章
- [x] 更新组件测试
- [x] 运行 `npm test -- models-section` 确认测试通过
- [x] 修复 autoWireProviderRoute 空映射逻辑 (commit e2fb289)

## TASK-004: 全量验证

- [x] 运行 `npm run typecheck` 确认无类型错误
- [x] 运行 `npm run lint` 确认无新增 lint 错误
- [x] 运行 `npx vitest run --retry=2` 确认全量测试通过 (32/32 相关测试通过)
- [x] 运行 `npm run build` 确认构建成功
- [x] 手动复现 Bug 1/2/3 场景验证修复

## 最终状态

- **PR**: #44 (已合并)
- **Revision**: 850923eb1945903987b2f7b2aadc40225468a710
- **Durable Spec Check**: ok=true, blocker_count=0
- **REVIEW-003**: ACCEPTED
- **VERIFY-001**: VERIFIED
- **所有 Issues**: #41 (Proposal), #42 (Design), #43 (Implement) 均已关闭
