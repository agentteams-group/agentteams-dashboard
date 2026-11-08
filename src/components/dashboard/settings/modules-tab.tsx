// 已迁出设置：模块更新不再是 Settings 的一个 tab。
//
// 入口移到团队详情抽屉的「千锻」卡片 → 四 tab 弹窗的「模块更新」tab
// （团队面默认当前团队，单版本下拉 + 单按钮安装/更新）。
// 实现：sections/teams/millforge/millforge-modules-tab.tsx；索引与状态
// 判定逻辑仍在 lib/module-updates.ts。
//
// 保留空模块而非物理删除：本容器审批策略不允许 rm/gio trash/mv，
// 删除动作待维护者在宿主侧执行（git rm src/components/dashboard/settings/modules-tab.tsx）。
export {};
