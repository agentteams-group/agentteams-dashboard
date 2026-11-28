import { describe, expect, it } from 'vitest';
import {
  LOOP_STATE_EVENT,
  LOOP_TEMPLATES,
  buildLoopRollback,
  canPublish,
  canRollback,
  isValidLoopDefinition,
  loopDefinitionStateEvent,
  loopStateEventKey,
  nextLoopDraftVersion,
  readStableLoopVersions,
  simulateLoopDryRun,
  templateToDraft,
  type LoopDefinition,
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

  it('f3-2：status=rolled_back 的定义（回滚产物）通过结构校验，不再被 readDrafts/导入静默过滤', () => {
    const base = templateToDraft(LOOP_TEMPLATES[0], 'a');
    expect(isValidLoopDefinition({ ...base, status: 'rolled_back' })).toBe(true);
  });

  it('f5-2：节点缺 type / type 大小写错 / type 拼错一律拒绝（渲染期 TypeError 前置拦截）', () => {
    const base = templateToDraft(LOOP_TEMPLATES[0], 'a');
    const missingType = {
      ...base,
      nodes: base.nodes.map((n, i) => (i === 1 ? { id: n.id, label: n.label } : n)),
    };
    expect(isValidLoopDefinition(missingType)).toBe(false);
    expect(
      isValidLoopDefinition({
        ...base,
        nodes: base.nodes.map((n) => (n.id === 'arch' ? { ...n, type: 'Agent' } : n)),
      }),
    ).toBe(false);
    expect(
      isValidLoopDefinition({
        ...base,
        nodes: base.nodes.map((n) => (n.id === 'arch' ? { ...n, type: 'typo-type' } : n)),
      }),
    ).toBe(false);
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

  it('publishes v1 → v2 and builds a v3 rollback from the v1 Matrix snapshot', () => {
    const v1: LoopDefinition = {
      ...templateToDraft(LOOP_TEMPLATES[0], 'admin'),
      name: 'v1 稳定定义',
      status: 'published',
      publishedAt: 100,
    };
    const v2: LoopDefinition = {
      ...v1,
      name: 'v2 稳定定义',
      version: 2,
      nodes: v1.nodes.map((node) => node.id === 'arch' ? { ...node, label: 'v2 架构' } : node),
      publishedAt: 200,
    };
    const state = [v2, v1].map((definition) => ({
      type: LOOP_STATE_EVENT,
      state_key: loopStateEventKey(definition),
      content: definition as unknown as Record<string, unknown>,
    }));

    expect(readStableLoopVersions(state, v1.id).map((item) => item.version)).toEqual([1, 2]);
    const result = buildLoopRollback(v2, readStableLoopVersions(state, v1.id), 'rollback-admin', 300);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition).toMatchObject({
      id: v1.id,
      name: 'v1 稳定定义',
      version: 3,
      status: 'rolled_back',
      restoredVersion: 1,
      rolledFromVersion: 2,
      updatedAt: 300,
    });
    expect(result.definition.nodes).toEqual(v1.nodes);
    expect(loopDefinitionStateEvent(result.definition)).toEqual({
      eventType: LOOP_STATE_EVENT,
      stateKey: `loop:${v1.id}:v3`,
      content: result.definition,
    });
  });

  it('refuses rollback without the current stable Matrix version and allocates fresh draft versions', () => {
    const v1: LoopDefinition = {
      ...templateToDraft(LOOP_TEMPLATES[0], 'admin'),
      status: 'published',
    };
    const v2: LoopDefinition = { ...v1, version: 2, status: 'published' };
    expect(buildLoopRollback(v2, [v1], 'admin')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('未在绑定空间发布'),
    });
    expect(nextLoopDraftVersion(v2, [v1, v2])).toBe(3);
    expect(nextLoopDraftVersion({ ...v2, version: 3, status: 'draft' }, [v1, v2])).toBe(3);
    expect(nextLoopDraftVersion({ ...v2, version: 3, status: 'draft' }, [v1, v2, { ...v2, version: 4 }])).toBe(5);
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
