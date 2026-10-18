import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_STATE_LABELS,
  artifactStateFromTask,
} from './artifact-state';

describe('artifactStateFromTask（F1.3 三态映射）', () => {
  it('completed 任务 → released，附 M1 放行记录降级说明', () => {
    const info = artifactStateFromTask({ status: 'completed' });
    expect(info.state).toBe('released');
    expect(info.note).toContain('任务完成态');
    expect(info.note).toContain('放行记录');
  });

  it('completed 但验收 REVISION_NEEDED → draft（需修订）', () => {
    const info = artifactStateFromTask({ status: 'completed', result_status: 'REVISION_NEEDED' });
    expect(info.state).toBe('draft');
    expect(info.note).toContain('REVISION_NEEDED');
  });

  it('completed 但验收 BLOCKED → draft（需修订）', () => {
    expect(artifactStateFromTask({ status: 'completed', result_status: 'BLOCKED' }).state).toBe('draft');
  });

  it('进行中/待处理/修订中 → draft 无降级说明', () => {
    for (const status of ['pending', 'delegated', 'in-progress', 'revision', 'blocked']) {
      const info = artifactStateFromTask({ status });
      expect(info.state).toBe('draft');
      expect(info.note).toBeUndefined();
    }
  });

  it('未知状态安全降级为 draft', () => {
    expect(artifactStateFromTask({}).state).toBe('draft');
    expect(artifactStateFromTask({ status: 'unknown-value' }).state).toBe('draft');
  });

  it('M1 不返回 pending_review（事实源待 M2 审查请求块）', () => {
    const states = ['completed', 'in-progress', 'pending'].map((s) =>
      artifactStateFromTask({ status: s }).state
    );
    expect(states).not.toContain('pending_review');
  });

  it('三态均有中文标签', () => {
    expect(ARTIFACT_STATE_LABELS).toEqual({
      draft: '草稿',
      pending_review: '待审',
      released: '已放行',
    });
  });
});

describe('artifactStateFromTask — 放行记录（F3.3）', () => {
  const releases = [
    { action: 'release' as const, actor: '@alice:example.org', ts: 1000 },
    { action: 'revoke' as const, actor: '@alice:example.org', ts: 2000 },
  ];

  it('最新记录 release → released（人工放行，无降级说明）', () => {
    const info = artifactStateFromTask(
      { status: 'in-progress' },
      [releases[0]],
      't1',
    );
    expect(info.state).toBe('released');
    expect(info.note).toContain('人工放行');
    expect(info.note).toContain('@alice:example.org');
  });

  it('release 后 revoke → 回 draft 并附撤销说明（历史不覆盖）', () => {
    const info = artifactStateFromTask({ status: 'completed' }, releases, 't1');
    expect(info.state).toBe('draft');
    expect(info.note).toContain('已撤销');
  });

  it('任务级记录只对匹配任务生效；项目级记录（无 task_id）对所有任务生效', () => {
    const taskScoped = [{ action: 'release' as const, actor: 'a', ts: 1, task_id: 't9' }];
    expect(artifactStateFromTask({ status: 'pending' }, taskScoped, 't1').state).toBe('draft');
    expect(artifactStateFromTask({ status: 'pending' }, taskScoped, 't9').state).toBe('released');
    const projectScoped = [{ action: 'release' as const, actor: 'a', ts: 1 }];
    expect(artifactStateFromTask({ status: 'pending' }, projectScoped, 't1').state).toBe('released');
  });

  it('空历史回退任务状态推导', () => {
    expect(artifactStateFromTask({ status: 'pending' }, [], 't1').state).toBe('draft');
  });
});
