/**
 * Pure helpers for scripts/upstream-watch.mjs.
 *
 * The CLI owns network access (gh api); everything here is deterministic so
 * digest rendering and alert rules can be unit-tested without a token.
 */

/**
 * @typedef {Object} WatchItem
 * @property {string} title
 * @property {string} url
 * @property {string} [author]
 * @property {string} [at] ISO timestamp
 * @property {number} [number]
 * @property {string} [sha]
 * @property {boolean} [draft]
 */

/**
 * @typedef {Object} RepoSnapshot
 * @property {string} id
 * @property {string} label
 * @property {string} repo
 * @property {'commits'|'pullRequests'|'branches'|'releases'} kind
 * @property {WatchItem[]} items
 * @property {string} [error]
 */

/**
 * @typedef {Object} Snapshot
 * @property {string} generatedAt
 * @property {number} windowDays
 * @property {RepoSnapshot[]} repos
 */

/**
 * @typedef {Object} Attention
 * @property {'blocker'|'warn'|'info'} level
 * @property {string} id
 * @property {string} message
 */

/** Repos the dashboard depends on or tracks, in digest order. */
export const WATCH_TARGETS = [
  {
    id: 'core-commits',
    label: 'AgentTeams 上游提交',
    repo: 'agentscope-ai/AgentTeams',
    kind: 'commits',
    ref: 'main',
  },
  {
    id: 'core-open-prs',
    label: 'LUOSENGWA 在 AgentTeams 的开放 PR',
    repo: 'agentscope-ai/AgentTeams',
    kind: 'pullRequests',
    author: 'LUOSENGWA',
  },
  {
    id: 'hiclaw-branches',
    label: 'HiClaw 活跃分支',
    repo: 'LUOSENGWA/HiClaw',
    kind: 'branches',
  },
  {
    id: 'workbench-releases',
    label: 'Workbench 发布',
    repo: 'LUOSENGWA/agentteams-qwenpaw-workbench',
    kind: 'releases',
  },
  {
    id: 'millforge-commits',
    label: 'Millforge 提交',
    repo: 'LUOSENGWA/Millforge',
    kind: 'commits',
    ref: 'main',
  },
  {
    id: 'qwenpaw-open-prs',
    label: 'QwenPaw 开放 PR',
    repo: 'LUOSENGWA/QwenPaw',
    kind: 'pullRequests',
    author: 'LUOSENGWA',
  },
];

const LEVEL_ORDER = { blocker: 0, warn: 1, info: 2 };

/**
 * @param {string[]} argv
 * @returns {{json: boolean, strict: boolean, out: string|null, days: number, help: boolean}}
 */
export function parseArgs(argv) {
  const options = { json: false, strict: false, out: null, days: 7, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--strict') {
      options.strict = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--out' || arg === '--days') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} 缺少参数值`);
      index += 1;
      if (arg === '--out') {
        options.out = value;
      } else {
        const days = Number(value);
        if (!Number.isInteger(days) || days < 1 || days > 90) {
          throw new Error('--days 需为 1-90 的整数');
        }
        options.days = days;
      }
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }

  return options;
}

/**
 * @param {string | undefined} iso
 * @param {string} nowIso
 * @returns {number | null} whole days, or null when the timestamp is missing/invalid
 */
export function ageDays(iso, nowIso) {
  if (!iso) return null;
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(then) || Number.isNaN(now)) return null;
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

/**
 * @param {Snapshot} snapshot
 * @param {{staleDays?: number}} [options]
 * @returns {Attention[]}
 */
export function summarizeAttention(snapshot, options = {}) {
  const staleDays = options.staleDays ?? 14;
  /** @type {Attention[]} */
  const attention = [];

  for (const repo of snapshot.repos) {
    if (repo.error) {
      attention.push({
        level: 'blocker',
        id: repo.id,
        message: `${repo.label}（${repo.repo}）拉取失败：${repo.error}`,
      });
      continue;
    }

    if (repo.kind === 'pullRequests') {
      const stale = repo.items.filter((item) => {
        const age = ageDays(item.at, snapshot.generatedAt);
        return age !== null && age > staleDays;
      });
      if (stale.length > 0) {
        attention.push({
          level: 'warn',
          id: repo.id,
          message: `${stale.length} 个开放 PR 超过 ${staleDays} 天未更新：${stale
            .map((item) => `#${item.number}`)
            .join('、')}`,
        });
      }

      const drafts = repo.items.filter((item) => item.draft).length;
      if (drafts > 0) {
        attention.push({
          level: 'info',
          id: repo.id,
          message: `${drafts} 个开放 PR 仍是 draft，合并前需转正`,
        });
      }
    }
  }

  return attention.sort(
    (left, right) => LEVEL_ORDER[left.level] - LEVEL_ORDER[right.level],
  );
}

/**
 * @param {string} value
 * @returns {string}
 */
function cell(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

/**
 * @param {string} value
 * @param {number} limit
 * @returns {string}
 */
function clamp(value, limit = 110) {
  const text = cell(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * @param {string | undefined} iso
 * @returns {string}
 */
function day(iso) {
  if (!iso) return '';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toISOString().slice(0, 10);
}

/**
 * @param {RepoSnapshot} repo
 * @returns {string}
 */
function repoSummary(repo) {
  if (repo.error) return '不可用';
  switch (repo.kind) {
    case 'commits': {
      const newest = repo.items[0];
      if (!newest) return '0 条提交';
      return `${repo.items.length} 条提交 · 最新 ${newest.sha ? newest.sha.slice(0, 7) : clamp(newest.title, 40)}`;
    }
    case 'pullRequests':
      return `${repo.items.length} 个开放 PR`;
    case 'branches':
      return `${repo.items.length} 个活跃分支`;
    case 'releases':
      return repo.items[0] ? clamp(repo.items[0].title, 60) : '无发布';
    default:
      return '';
  }
}

/**
 * @param {RepoSnapshot} repo
 * @param {WatchItem} item
 * @returns {string}
 */
function renderItem(repo, item) {
  if (repo.kind === 'branches') {
    const meta = [];
    if (item.sha) meta.push(`\`${item.sha.slice(0, 7)}\``);
    if (item.at) meta.push(day(item.at));
    const suffix = meta.length > 0 ? ` — ${meta.join(' · ')}` : '';
    return `- [${clamp(item.title)}](${item.url})${suffix}`;
  }

  const meta = [];
  if (item.author) meta.push(`@${item.author}`);
  if (item.at) meta.push(day(item.at));
  const suffix = meta.length > 0 ? ` — ${meta.join(' · ')}` : '';

  if (item.number !== undefined) {
    const draft = item.draft ? '（draft）' : '';
    return `- [#${item.number}](${item.url}) ${clamp(item.title)}${draft}${suffix}`;
  }
  if (item.sha) {
    return `- [\`${item.sha.slice(0, 7)}\`](${item.url}) ${clamp(item.title)}${suffix}`;
  }
  return `- [${clamp(item.title)}](${item.url})${suffix}`;
}

/**
 * @param {Snapshot} snapshot
 * @param {{staleDays?: number}} [options]
 * @returns {string}
 */
export function buildDigest(snapshot, options = {}) {
  const staleDays = options.staleDays ?? 14;
  const attention = summarizeAttention(snapshot, { staleDays });
  const failures = snapshot.repos.filter((repo) => repo.error).length;

  /** @type {string[]} */
  const lines = [
    `# 上游与协作方周报（${day(snapshot.generatedAt)}）`,
    '',
    `生成时间：${snapshot.generatedAt} ｜ 提交窗口：最近 ${snapshot.windowDays} 天 ｜ 目标：${snapshot.repos.length} 个 ｜ 数据源失败：${failures}`,
    '',
    '## 需要关注',
    '',
  ];

  if (attention.length === 0) {
    lines.push('无需人工介入。');
  } else {
    for (const item of attention) {
      lines.push(`- [${item.level.toUpperCase()}] ${item.message}`);
    }
  }

  lines.push('', '## 版本与状态', '', '| 目标 | 仓库 | 状态 |', '| --- | --- | --- |');
  for (const repo of snapshot.repos) {
    lines.push(`| ${cell(repo.label)} | \`${cell(repo.repo)}\` | ${cell(repoSummary(repo))} |`);
  }

  for (const repo of snapshot.repos) {
    lines.push('', `## ${repo.label}`, '', `仓库：\`${repo.repo}\` ｜ 类型：${repo.kind}`);
    if (repo.error) {
      lines.push('', `> 拉取失败：${repo.error}`);
      continue;
    }
    if (repo.items.length === 0) {
      lines.push('', '窗口内无记录。');
      continue;
    }
    lines.push('');
    for (const item of repo.items) lines.push(renderItem(repo, item));
  }

  lines.push(
    '',
    '---',
    '',
    '由 `npm run upstream:watch` 生成。告警规则：数据源失败为 blocker；开放 PR 超过 14 天未更新为 warn；draft PR 为 info。',
    '',
  );

  return lines.join('\n');
}

/**
 * @param {string} [script]
 * @returns {string}
 */
export function usage(script = 'node scripts/upstream-watch.mjs') {
  return [
    'Usage: ' + script + ' [options]',
    '',
    'Options:',
    '  --days <n>  提交窗口天数，1-90，默认 7',
    '  --out <file> 将 Markdown 摘要写入文件（默认写 stdout）',
    '  --json      输出原始快照 JSON 而不是 Markdown',
    '  --strict    任一数据源失败时以非零码退出',
    '  -h, --help  显示帮助',
    '',
    'Requires the GitHub CLI (gh) with a token that can read public repos.',
  ].join('\n');
}
