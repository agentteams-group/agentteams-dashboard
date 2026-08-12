#!/usr/bin/env node
/**
 * AI-tone copy scanner (任务书 AC-T1 / AC-W8).
 *
 * Scans visible copy in all .ts/.tsx files under src/ for template AI
 * phrases and exits non-zero on any hit. Test files and comment-only lines are excluded; the
 * scan is a hard-word gate, subjective copy review stays human (任务书 §9).
 *
 * Usage: node scripts/ai-tone-scan.mjs [--src-dir <dir>]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const BANNED_ZH = [
  '智能体',
  '为您',
  '您好',
  '请问',
  '我可以帮您',
  '非常高兴',
  '希望对您有帮助',
  '如有任何问题',
  '请随时告诉我',
  '让我们一起',
  '首先我们需要',
  '综上所述',
  '值得注意的是',
];

const BANNED_EN = [
  'I can help',
  "I'd be happy to",
  'Let me',
  "Here's what I can do",
  'As an AI',
  'Feel free to ask',
  'Hope this helps',
];

const BANNED = [...BANNED_ZH, ...BANNED_EN];

function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip comment-only lines; inline code comments are kept (rare in copy). */
function isCommentLine(line) {
  const t = line.trim();
  return (
    t.startsWith('//') ||
    t.startsWith('/*') ||
    t.startsWith('*') ||
    t.startsWith('{/*') ||
    t.startsWith('<!--')
  );
}

function scanFile(file) {
  const hits = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;
    for (const word of BANNED) {
      if (line.includes(word)) {
        hits.push({ line: index + 1, word, text: line.trim().slice(0, 120) });
      }
    }
  });
  return hits;
}

const srcDir = (() => {
  const flagIndex = process.argv.indexOf('--src-dir');
  return flagIndex >= 0 ? process.argv[flagIndex + 1] : join(ROOT, 'src');
})();

const files = collectFiles(srcDir);
let totalHits = 0;

for (const file of files) {
  const hits = scanFile(file);
  if (hits.length === 0) continue;
  totalHits += hits.length;
  const rel = relative(ROOT, file);
  for (const hit of hits) {
    console.error(`${rel}:${hit.line}  命中禁词「${hit.word}」  ${hit.text}`);
  }
}

if (totalHits > 0) {
  console.error(`\nAI 味扫描失败：共 ${totalHits} 处命中（${files.length} 个文件受检）。`);
  process.exit(1);
}

process.stdout.write(`AI 味扫描通过：${files.length} 个文件，0 命中。\n`);
