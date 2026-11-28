export const DEVELOPMENT_SQUAD_SKILL_BASE = 'https://agentteams.cloud/skills/development-squad/v1';

export const DEVELOPMENT_ROLES = [
  { id: 'leader', title: '研发 Leader', skillName: 'dev-squad-leader', description: '组织 Issue 分析、开发、独立测试与 PR 交付。' },
  { id: 'developer', title: '开发工程师', skillName: 'dev-squad-developer', description: '按需求实现代码、补充测试，并提交可评审的变更。' },
  { id: 'reviewer', title: 'Issue 分析员', skillName: 'dev-squad-reviewer', description: '分析需求、实现方案、影响范围和验收标准。' },
  { id: 'tester', title: '测试工程师', skillName: 'dev-squad-tester', description: '验证功能、边界与回归，并输出可复现的测试报告。' },
] as const;

