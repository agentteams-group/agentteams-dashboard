import { describe, expect, it } from 'vitest';
import {
  WATCH_TARGETS,
  ageDays,
  buildDigest,
  parseArgs,
  summarizeAttention,
  usage,
} from '../../scripts/lib/upstream-watch.mjs';

const NOW = '2026-10-25T00:00:00.000Z';

function repo(overrides: Record<string, unknown>) {
  return {
    id: 'repo',
    label: '仓库',
    repo: 'owner/name',
    kind: 'commits',
    items: [],
    ...overrides,
  } as Parameters<typeof buildDigest>[0]['repos'][number];
}

function snapshot(repos: unknown[], windowDays = 7) {
  return {
    generatedAt: NOW,
    windowDays,
    repos,
  } as Parameters<typeof buildDigest>[0];
}

describe('parseArgs', () => {
  it('applies defaults', () => {
    expect(parseArgs([])).toEqual({
      json: false,
      strict: false,
      out: null,
      days: 7,
      help: false,
    });
  });

  it('parses flags and values', () => {
    expect(parseArgs(['--json', '--strict', '--days', '30', '--out', 'report.md'])).toEqual({
      json: true,
      strict: true,
      out: 'report.md',
      days: 30,
      help: false,
    });
  });

  it('rejects unknown flags and missing values', () => {
    expect(() => parseArgs(['--nope'])).toThrow('未知参数');
    expect(() => parseArgs(['--out'])).toThrow('缺少参数值');
    expect(() => parseArgs(['--days'])).toThrow('缺少参数值');
  });

  it('rejects an out-of-range window', () => {
    expect(() => parseArgs(['--days', '0'])).toThrow('1-90');
    expect(() => parseArgs(['--days', '91'])).toThrow('1-90');
    expect(() => parseArgs(['--days', '7.5'])).toThrow('1-90');
  });
});

describe('ageDays', () => {
  it('counts whole days and tolerates future timestamps', () => {
    expect(ageDays('2026-10-20T00:00:00.000Z', NOW)).toBe(5);
    expect(ageDays('2026-10-26T00:00:00.000Z', NOW)).toBe(0);
  });

  it('returns null for missing or invalid timestamps', () => {
    expect(ageDays(undefined, NOW)).toBeNull();
    expect(ageDays('not-a-date', NOW)).toBeNull();
  });
});

describe('summarizeAttention', () => {
  it('orders blockers before warnings before info', () => {
    const attention = summarizeAttention(
      snapshot([
        repo({
          id: 'prs',
          kind: 'pullRequests',
          items: [
            { title: 'stale', url: 'https://example.test/1', number: 1, at: '2026-10-01T00:00:00.000Z' },
            { title: 'draft', url: 'https://example.test/2', number: 2, at: '2026-10-24T00:00:00.000Z', draft: true },
          ],
        }),
        repo({ id: 'broken', error: 'gh: HTTP 502' }),
      ]),
    );

    expect(attention.map((item) => item.level)).toEqual(['blocker', 'warn', 'info']);
    expect(attention[0].message).toContain('HTTP 502');
    expect(attention[1].message).toContain('#1');
    expect(attention[2].message).toContain('draft');
  });

  it('stays quiet when all repositories are healthy', () => {
    expect(
      summarizeAttention(
        snapshot([
          repo({
            kind: 'commits',
            items: [{ title: 'feat: signal events', url: 'https://example.test/c', sha: 'abcdef1234' }],
          }),
        ]),
      ),
    ).toEqual([]);
  });
});

describe('buildDigest', () => {
  it('renders attention, status table and per-repo sections', () => {
    const digest = buildDigest(
      snapshot([
        repo({
          id: 'core-commits',
          label: 'AgentTeams 上游提交',
          repo: 'agentscope-ai/AgentTeams',
          items: [
            {
              title: 'feat(signal): add signal events\n\nbody line',
              url: 'https://example.test/commit',
              sha: 'abcdef1234567',
              author: 'alice',
              at: '2026-10-24T08:00:00.000Z',
            },
          ],
        }),
        repo({
          id: 'core-open-prs',
          label: '开放 PR',
          repo: 'agentscope-ai/AgentTeams',
          kind: 'pullRequests',
          items: [
            {
              title: 'feat: strong consistency | projection',
              url: 'https://example.test/pr/42',
              number: 42,
              author: 'LUOSENGWA',
              at: '2026-10-01T00:00:00.000Z',
              draft: true,
            },
          ],
        }),
        repo({
          id: 'workbench-releases',
          label: 'Workbench 发布',
          repo: 'LUOSENGWA/agentteams-qwenpaw-workbench',
          kind: 'releases',
          items: [
            { title: 'v0.5.0-beta.16 — cockpit', url: 'https://example.test/rel', at: '2026-10-20T00:00:00.000Z' },
          ],
        }),
        repo({
          id: 'hiclaw-branches',
          label: 'HiClaw 分支',
          repo: 'LUOSENGWA/HiClaw',
          kind: 'branches',
          items: [{ title: 'feat/approval', url: 'https://example.test/tree', sha: '9999999' }],
        }),
        repo({ id: 'broken', label: '不可用仓库', repo: 'owner/broken', error: 'HTTP 502' }),
      ]),
    );

    expect(digest).toContain('# 上游与协作方周报（2026-10-25）');
    expect(digest).toContain('提交窗口：最近 7 天');
    expect(digest).toContain('数据源失败：1');
    expect(digest).toContain('[BLOCKER] 不可用仓库（owner/broken）拉取失败：HTTP 502');
    expect(digest).toContain('[WARN] 1 个开放 PR 超过 14 天未更新：#42');
    expect(digest).toContain('[INFO] 1 个开放 PR 仍是 draft');
    expect(digest).toContain('| AgentTeams 上游提交 | `agentscope-ai/AgentTeams` | 1 条提交 · 最新 abcdef1 |');
    expect(digest).toContain('- [`abcdef1`](https://example.test/commit) feat(signal): add signal events body line — @alice · 2026-10-24');
    expect(digest).toContain('- [#42](https://example.test/pr/42) feat: strong consistency \\| projection（draft） — @LUOSENGWA · 2026-10-01');
    expect(digest).toContain('- [v0.5.0-beta.16 — cockpit](https://example.test/rel) — 2026-10-20');
    expect(digest).toContain('- [feat/approval](https://example.test/tree) — `9999999`');
    expect(digest).toContain('> 拉取失败：HTTP 502');
  });

  it('states that no action is needed when everything is healthy', () => {
    const digest = buildDigest(snapshot([repo({ id: 'empty', label: '空仓库' })]));
    expect(digest).toContain('无需人工介入。');
    expect(digest).toContain('窗口内无记录。');
  });

  it('always includes the rule footer', () => {
    const digest = buildDigest(snapshot([]));
    expect(digest).toContain('由 `npm run upstream:watch` 生成');
    expect(digest).toContain('超过 14 天未更新为 warn');
  });
});

describe('WATCH_TARGETS', () => {
  it('uses unique ids and owner/name repos', () => {
    const ids = WATCH_TARGETS.map((target) => target.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const target of WATCH_TARGETS) {
      expect(target.repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
    }
  });

  it('tracks the core repo, LUOSENGWA forks and the workbench companion', () => {
    const repos = new Set(WATCH_TARGETS.map((target) => target.repo));
    expect(repos).toContain('agentscope-ai/AgentTeams');
    expect(repos).toContain('LUOSENGWA/HiClaw');
    expect(repos).toContain('LUOSENGWA/agentteams-qwenpaw-workbench');
    expect(repos).toContain('LUOSENGWA/Millforge');
    expect(repos).toContain('LUOSENGWA/QwenPaw');
  });
});

describe('usage', () => {
  it('documents every supported flag', () => {
    const text = usage();
    for (const flag of ['--days', '--out', '--json', '--strict', '--help']) {
      expect(text).toContain(flag);
    }
  });
});
