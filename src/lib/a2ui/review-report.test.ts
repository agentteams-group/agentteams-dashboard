import { describe, expect, it } from 'vitest';
import { normalizeReviewReportPayload } from './protocol';

describe('normalizeReviewReportPayload（F3.1 review.report 消费侧）', () => {
  it('合法报告：round/verdict/issues 全量归一化', () => {
    const block = normalizeReviewReportPayload({
      round: 2,
      verdict: 'revision_needed',
      title: '产品介绍页审查',
      summary: '2 阻断 2 建议',
      project_id: 'proj-1',
      issues: [
        { id: 'i1', severity: 'blocker', anchor: 'index.html:12', repro: '打开页面即白屏', owner_node: 't3' },
        { id: 'i2', severity: 'suggestion', anchor: 'styles.css' },
        { id: 'bad' },
        { id: 'i3', severity: 'unknown' },
      ],
    });
    expect(block?.payload.round).toBe(2);
    expect(block?.payload.verdict).toBe('revision_needed');
    expect(block?.payload.issues).toHaveLength(2);
    expect(block?.payload.issues[0]).toEqual({
      id: 'i1',
      severity: 'blocker',
      anchor: 'index.html:12',
      repro: '打开页面即白屏',
      owner_node: 't3',
    });
  });

  it('畸形报告（round 非数 / verdict 未知 / issues 空）全部拒绝 → 文本启发式兜底', () => {
    expect(normalizeReviewReportPayload({ round: 'x', verdict: 'pass', issues: [{ id: 'a', severity: 'blocker' }] })).toBeUndefined();
    expect(normalizeReviewReportPayload({ round: 1, verdict: 'maybe', issues: [{ id: 'a', severity: 'blocker' }] })).toBeUndefined();
    expect(normalizeReviewReportPayload({ round: 1, verdict: 'pass', issues: [] })).toBeUndefined();
    expect(normalizeReviewReportPayload({ round: 1, verdict: 'pass' })).toBeUndefined();
    expect(normalizeReviewReportPayload(null)).toBeUndefined();
  });
});
