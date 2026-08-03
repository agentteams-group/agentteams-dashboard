# 任务清单：技能中心（Skill Center）

## Phase 1: 基础设施

- [ ] 新建 API 路由 `src/app/api/agentteams/skills/route.ts`
  - GET /api/agentteams/skills - 获取技能列表
  - POST /api/agentteams/skills - 上传技能包
- [ ] 新建 API 路由 `src/app/api/agentteams/skills/[name]/route.ts`
  - GET /api/agentteams/skills/[name] - 获取技能详情
  - PUT /api/agentteams/skills/[name] - 更新技能元信息
  - DELETE /api/agentteams/skills/[name] - 删除技能
- [ ] 新建 API 路由 `src/app/api/agentteams/skills/nacos/config/route.ts`
  - GET /api/agentteams/skills/nacos/config - 获取 Nacos 配置
  - PUT /api/agentteams/skills/nacos/config - 更新 Nacos 配置
- [ ] 新建 API 路由 `src/app/api/agentteams/skills/nacos/sync/route.ts`
  - POST /api/agentteams/skills/nacos/sync - 手动触发 Nacos 同步
- [ ] 新建 Hooks `src/hooks/use-skill-center.ts`
  - useSkills, useSkill, useCreateSkill, useUpdateSkill, useDeleteSkill
- [ ] 新建 Hooks `src/hooks/use-nacos-config.ts`
  - useNacosConfig, useUpdateNacosConfig, useNacosSync
- [ ] 扩展 `src/lib/skill-package.ts` 添加 Nacos 技能解析逻辑（可选）

## Phase 2: 技能中心页面

- [ ] 新建组件 `src/components/dashboard/sections/skills/skill-center.tsx`
  - 技能列表表格渲染
  - 搜索和筛选功能
  - 来源标识（自定义 / Nacos）
- [ ] 新建组件 `src/components/dashboard/sections/skills/skill-upload-dialog.tsx`
  - 拖拽上传 ZIP 文件
  - 技能预览展示
  - 名称冲突处理
- [ ] 新建组件 `src/components/dashboard/sections/skills/nacos-config-dialog.tsx`
  - Nacos 配置表单
  - 同步状态显示
  - 手动同步触发
- [ ] 重构 `src/components/dashboard/sections/skills-section.tsx`
  - 集成 SkillCenter 组件
  - 保留现有 MCP 服务器管理功能

## Phase 3: Worker 创建集成

- [ ] 新建组件 `src/components/dashboard/sections/skills/skill-selector.tsx`
  - 模糊搜索技能
  - 多选技能
  - 来源筛选
- [ ] 修改 `src/components/dashboard/sections/workers/worker-create-dialog.tsx`
  - 集成 SkillSelector 组件
  - 替换原有的「技能（逗号分隔）」输入框
- [ ] 修改 `src/lib/agentteams-api.ts`
  - 扩展 CreateWorkerRequest 添加技能关联字段（如 skillReferences）
  - 更新 API 客户端方法

## Phase 4: 优化与测试

- [ ] 添加 Nacos 定时同步逻辑（如每 5 分钟自动刷新）
- [ ] 添加技能名称冲突处理 UI（覆盖确认对话框）
- [ ] 编写单元测试
  - `src/app/api/agentteams/skills/route.test.ts`
  - `src/app/api/agentteams/skills/[name]/route.test.ts`
  - `src/hooks/use-skill-center.test.ts`
- [ ] 编写集成测试
  - 技能上传完整流程
  - Nacos 配置与同步流程
  - Worker 创建技能选择流程
- [ ] 性能优化
  - 技能列表分页
  - Nacos 配置缓存

---

## 验收标准

1. 技能中心页面可正常访问，表格展示自定义和 Nacos 技能
2. 支持上传自定义技能包，支持编辑和删除自定义技能
3. Nacos 配置可保存，手动触发同步可拉取技能列表
4. 创建 Worker 时可从技能中心选择技能
5. 选定的技能可正确关联到 Worker
