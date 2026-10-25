#!/usr/bin/env node
/**
 * Multi-repo upstream watch (design doc E1).
 *
 * Pulls recent commits, open PRs, branches and releases for the repos the
 * dashboard depends on, then renders a Markdown digest. Read-only: it never
 * writes to GitHub. See scripts/lib/upstream-watch.mjs for the pure rules.
 *
 * Usage: node scripts/upstream-watch.mjs [--days 7] [--out file] [--json] [--strict]
 */

import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import {
  WATCH_TARGETS,
  buildDigest,
  parseArgs,
  usage,
} from './lib/upstream-watch.mjs';

const run = promisify(execFile);
const MAX_BUFFER = 32 * 1024 * 1024;

async function ghApi(args) {
  const { stdout } = await run('gh', ['api', '--method', 'GET', ...args], {
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  return JSON.parse(stdout);
}

function firstLine(message) {
  return String(message ?? '').split('\n')[0].trim();
}

async function fetchCommits(target, since) {
  const rows = await ghApi([
    `repos/${target.repo}/commits`,
    '-f',
    `sha=${target.ref ?? 'main'}`,
    '-f',
    'per_page=30',
    '-f',
    `since=${since}`,
  ]);
  return rows.map((row) => ({
    title: firstLine(row.commit?.message),
    sha: row.sha,
    url: row.html_url,
    author: row.author?.login ?? row.commit?.author?.name,
    at: row.commit?.author?.date,
  }));
}

async function fetchPullRequests(target) {
  const query = [
    `repo:${target.repo}`,
    'is:pr',
    'is:open',
    target.author ? `author:${target.author}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const result = await ghApi([
    'search/issues',
    '-f',
    `q=${query}`,
    '-f',
    'per_page=50',
    '-f',
    'sort=updated',
    '-f',
    'order=desc',
  ]);
  return (result.items ?? []).map((item) => ({
    title: item.title,
    number: item.number,
    url: item.html_url,
    author: item.user?.login,
    at: item.updated_at,
    draft: Boolean(item.draft),
  }));
}

async function fetchBranches(target) {
  const rows = await ghApi([`repos/${target.repo}/branches`, '-f', 'per_page=30']);
  return rows.map((row) => ({
    title: row.name,
    sha: row.commit?.sha,
    url: `https://github.com/${target.repo}/tree/${encodeURIComponent(row.name)}`,
  }));
}

async function fetchReleases(target) {
  const rows = await ghApi([`repos/${target.repo}/releases`, '-f', 'per_page=10']);
  return rows.map((row) => ({
    title:
      row.name && row.name !== row.tag_name
        ? `${row.tag_name} — ${row.name}`
        : row.tag_name,
    url: row.html_url,
    author: row.author?.login,
    at: row.published_at,
  }));
}

const FETCHERS = {
  commits: fetchCommits,
  pullRequests: fetchPullRequests,
  branches: fetchBranches,
  releases: fetchReleases,
};

async function collectTarget(target, since) {
  try {
    const fetcher = FETCHERS[target.kind];
    if (!fetcher) throw new Error(`未知类型 ${target.kind}`);
    const items = await fetcher(target, since);
    return {
      id: target.id,
      label: target.label,
      repo: target.repo,
      kind: target.kind,
      items,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      id: target.id,
      label: target.label,
      repo: target.repo,
      kind: target.kind,
      items: [],
      error: firstLine(detail.replace(/^Command failed:.*\n?/, '')) || '未知错误',
    };
  }
}

async function collect(days) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const repos = await Promise.all(
    WATCH_TARGETS.map((target) => collectTarget(target, since)),
  );
  return {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    repos,
  };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n`);
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const snapshot = await collect(options.days);
  const digest = buildDigest(snapshot);

  if (options.out) writeFileSync(options.out, `${digest}\n`, 'utf8');
  process.stdout.write(options.json ? `${JSON.stringify(snapshot, null, 2)}\n` : `${digest}\n`);

  if (options.strict && snapshot.repos.some((repo) => repo.error)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`upstream-watch failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
