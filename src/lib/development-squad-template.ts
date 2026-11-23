export const DEVELOPMENT_SQUAD_SKILL_VERSION = '1.0.0';
export const DEVELOPMENT_SQUAD_SKILL_BASE = 'https://agentteams.cloud/skills/development-squad/v1';

export const DEVELOPMENT_ROLES = [
  { id: 'leader', title: '研发 Leader', skillName: 'dev-squad-leader', description: '分析社区 Issue、核实 Bug 与关联 PR，再组织开发、评审和测试。' },
  { id: 'developer', title: '开发工程师', skillName: 'dev-squad-developer', description: '按需求实现代码、补充测试，并提交可评审的变更。' },
  { id: 'reviewer', title: '代码评审工程师', skillName: 'dev-squad-reviewer', description: '独立检查需求覆盖、代码正确性、安全性和回归风险。' },
  { id: 'tester', title: '测试工程师', skillName: 'dev-squad-tester', description: '验证功能、边界与回归，并输出可复现的测试报告。' },
] as const;

