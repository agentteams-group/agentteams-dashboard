# 任务清单: 修复模型别名绑定与路由自动接入逻辑

## TASK-001: 修复 model-bindings.ts 冲突检测与透传标记

- [ ] 扩展 `AgentTeamsModelBinding` 接口，新增 `conflict?: boolean` 和 `passthrough?: boolean` 字段
- [ ] 在 `buildModelBindings` 中实现冲突检测逻辑
- [ ] 新增测试用例验证冲突检测和透传标记
- [ ] 运行 `npm run typecheck` 确认无类型错误
- [ ] 运行 `npm test -- model-bindings` 确认测试通过

## TASK-002: 修复 model-catalog.ts 下拉框归属

- [ ] 修改 `buildModelSelectionOptions` 处理冲突绑定
- [ ] 更新 `ModelSelectionOption` 接口
- [ ] 新增测试用例验证下拉框归属正确性
- [ ] 运行 `npm test -- model-catalog` 确认测试通过

## TASK-003: 修复 models-section.tsx 自动路由创建逻辑

- [ ] 修改 `autoWireProviderRoute`，空映射时跳过路由创建
- [ ] 修改绑定表 UI，新增冲突和透传徽章
- [ ] 更新组件测试
- [ ] 运行 `npm test -- models-section` 确认测试通过

## TASK-004: 全量验证

- [ ] 运行 `npm run typecheck` 确认无类型错误
- [ ] 运行 `npm run lint` 确认无新增 lint 错误
- [ ] 运行 `npx vitest run --retry=2` 确认全量测试通过
- [ ] 运行 `npm run build` 确认构建成功
- [ ] 手动复现 Bug 1/2/3 场景验证修复