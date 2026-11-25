import { describe, expect, it } from 'vitest';
import { parseWorkflowNotice } from './chat-workflow-notice';

describe('workflow message presentation', () => {
  it('presents Codex bridge progress only for its owning runtime', () => {
    expect(parseWorkflowNotice('Codex is working: commandExecution.', 'codex')).toMatchObject({ kind: 'progress', title: '正在执行命令' });
    expect(parseWorkflowNotice('Codex is working: commandExecution.', 'qwenpaw')).toBeNull();
  });
  it('presents ProjectFlow without exposing command names, ids or routing details', () => {
    const body = '[ProjectFlow] create_project + plan_dag: 项目「工单系统优先级、筛选与统计交付」（projectId=ticket-01）已在任务房间 !task:server 创建并完成 DAG 规划。';
    expect(parseWorkflowNotice(body)).toMatchObject({ title: '项目已启动', subject: '工单系统优先级、筛选与统计交付', description: '执行计划已生成', body });
  });

  it('turns assignment boilerplate and the full spec into a named assignment notice', () => {
    const body = '@dev:server You are assigned task **p-01**: 建立最小可运行基线\n\n# Task p-01\n## Context\nInternal spec';
    expect(parseWorkflowNotice(body)).toMatchObject({ title: '任务已分配', subject: '建立最小可运行基线', description: '执行者：dev', body });
  });

  it('treats TASK_COMPLETED as submitted rather than already accepted', () => {
    expect(parseWorkflowNotice('@lead:server TASK_COMPLETED: p-01 - Result: shared/tasks/p-01/result.md')).toMatchObject({ title: '任务已提交', description: '等待验收' });
  });

  it.each([['TASK_BLOCKED', '任务已阻塞'], ['TASK_REVISION_NEEDED', '任务需要修订'], ['TASK_INTERRUPTED', '任务已中断']])('preserves the explanation for %s', (token, title) => {
    expect(parseWorkflowNotice('@lead:server ' + token + ': p-01 - 数据库连接失败')).toMatchObject({ title, description: '数据库连接失败' });
  });

  it('keeps request routes inside the original detail instead of the summary', () => {
    expect(parseWorkflowNotice('PROJECT_REQUESTED: 工单系统改造\nReplyRoute: matrix/private\nTaskRoom: !room:server')).toMatchObject({ title: '项目请求已转交', subject: '工单系统改造' });
  });

  it('packages a generated file publication without showing storage paths', () => {
    expect(parseWorkflowNotice('@dev:server 📎 已发布 baseline.tar.gz（52.4 KB）— shared/tasks/p-01/baseline.tar.gz；结论/下一步见文件')).toMatchObject({ title: '交付文件已更新', subject: 'baseline.tar.gz', description: '52.4 KB' });
  });

  it.each(['我想了解 [ProjectFlow] create_project 的含义', '[ProjectFlow] 是一种内部通知: 解释如下', '```text\nTASK_COMPLETED: example\n```', '[UnknownFlow] test: example', '普通的项目进度说明'])('keeps ordinary and quoted text unchanged: %s', body => {
    expect(parseWorkflowNotice(body)).toBeNull();
  });
});
