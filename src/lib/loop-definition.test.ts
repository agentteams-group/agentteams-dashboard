import { describe, expect, it } from 'vitest';
import {
  LOOP_TEMPLATES,
  canPublish,
  canRollback,
  isValidLoopDefinition,
  simulateLoopDryRun,
  templateToDraft,
} from './loop-definition';

describe('loop-definition（F5.2/F5.3/F5.5 模型）', () => {
  it('内置模板 ≥5 且全部结构合法、start→end 可达', () => {
    expect(LOOP_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    for (const tpl of LOOP_TEMPLATES) {
      const draft = templateToDraft(tpl, '@admin:example.org');
      expect(isValidLoopDefinition(draft)).toBe(true);
      expect(canPublish(draft).ok).toBe(true);
    }
  });

  it('templateToDraft 产出 v1 草稿并记录操作者', () => {
    const draft = templateToDraft(LOOP_TEMPLATES[0], '@me:example.org');
    expect(draft.version).toBe(1);
    expect(draft.status).toBe('draft');
    expect(draft.updatedBy).toBe('@me:example.org');
  });

  it('结构校验拒绝缺 end / 断边 / 畸形版本', () => {
    const base = templateToDraft(LOOP_TEMPLATES[0], 'a');
    expect(isValidLoopDefinition({ ...base, nodes: base.nodes.filter((n) => n.type !== 'end') })).toBe(false);
    expect(isValidLoopDefinition({ ...base, edges: [{ id: 'x', source: 'ghost', target: 'end' }] })).toBe(false);
    expect(isValidLoopDefinition({ ...base, version: 0 })).toBe(false);
    expect(isValidLoopDefinition(null)).toBe(false);
  });

  it('canPublish：published 不可再发布；不可达图拒绝并给出原因', () => {
    const draft = templateToDraft(LOOP_TEMPLATES[0], 'a');
    expect(canPublish({ ...draft, status: 'published' })).toMatchObject({ ok: false });
    const broken = {
      ...draft,
      edges: draft.edges.filter((e) => e.target !== 'end' || e.source === 'review'),
    };
    // 移除其余指向 end 的边后 start 不可达 end
    const noEndEdges = { ...draft, edges: draft.edges.filter((e) => e.target !== 'end') };
    const result = canPublish(noEndEdges);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('end');
    expect(canPublish(broken).ok).toBe(true); // 原 start→…→review→end 主链保留
  });

  it('canRollback：仅已发布的 v2+ 循环允许执行回滚', () => {
    const draft = templateToDraft(LOOP_TEMPLATES[0], 'a');
    expect(canRollback(draft).ok).toBe(false); // 草稿不可回滚

    const publishedV1 = { ...draft, status: 'published' as const, version: 1 };
    expect(canRollback(publishedV1).ok).toBe(false); // v1 无更早版本

    const publishedV2 = { ...draft, status: 'published' as const, version: 2 };
    expect(canRollback(publishedV2).ok).toBe(true);
  });

  it('simulateLoopDryRun：推演主干步骤序列并标出分支警告', () => {
    const draft = templateToDraft(LOOP_TEMPLATES[0], 'a');
    const result = simulateLoopDryRun(draft);

    expect(result.reachable).toBe(true);
    expect(result.steps.length).toBeGreaterThan(2);
    expect(result.steps[0].nodeId).toBe('start');
    expect(result.steps[result.steps.length - 1].nodeType).toBe('end');
  });
});
