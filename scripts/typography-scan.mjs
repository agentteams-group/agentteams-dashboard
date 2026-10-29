#!/usr/bin/env node
/**
 * 排版标度扫描（方案 v3 A-3）。
 *
 * 全站字号只允许三档：标题 `text-sm font-semibold`、正文 `text-sm`、元信息
 * `text-xs`。写 `text-[10px]` 这类任意值有两个实际代价，不只是「不统一」：
 * 1. 企业主题的 `fontSize` 参数改的是根字号（`src/lib/theme/apply.ts`），
 *    px 任意值不跟着缩放——放大字号的用户看到别的都变大、只有这块不变；
 * 2. 三套主题（亮 / 暗 / 高对比度）与 30+ 主题参数下，逐处写死的小字号没人
 *    能一次改全。
 *
 * 所以这里把「禁止」做成能跑的检查，接在 `npm run lint` 后面。
 *
 * 用法：node scripts/typography-scan.mjs [--src-dir <dir>]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 任意值字号：`text-[10px]` / `text-[0.7rem]` / `text-[length:…]` 都算。 */
const ARBITRARY_TEXT_SIZE = /\btext-\[[^\]]*(px|rem|em|length:)[^\]]*\]/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const srcFlag = argv.indexOf('--src-dir');
  const srcDir = srcFlag !== -1 ? argv[srcFlag + 1] : join(ROOT, 'src');
  const hits = [];

  for (const file of walk(srcDir)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      // 注释里出现「text-[10px]」是在解释规矩，不算违规。
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      if (line.includes('typography-scan-allow')) return;
      const matches = line.match(ARBITRARY_TEXT_SIZE);
      if (matches) hits.push({ file: relative(ROOT, file), line: i + 1, text: matches.join(' ') });
    });
  }

  if (hits.length === 0) {
    process.stdout.write('typography-scan: 字号全部走三档标度（text-xs / text-sm），无任意值。\n');
    return;
  }

  console.error(`typography-scan: 发现 ${hits.length} 处任意值字号（应用 text-xs 或 text-sm）：`);
  for (const hit of hits) console.error(`  ${hit.file}:${hit.line}: ${hit.text}`);
  console.error('  根字号由企业主题的 fontSize 参数缩放，px 任意值不跟随——见 docs/theme-customization.md。');
  process.exit(1);
}

main();
