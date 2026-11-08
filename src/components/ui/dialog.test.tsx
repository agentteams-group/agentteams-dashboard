import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';

// 弹窗防溢出容器的静态门（本批对话类问题审计口径）：
//   · DialogContent 自身必须是收敛容器：min-w-0 + 视口内 max-h + overflow-x-hidden
//     + overflow-y-auto 兜底 + 子项 min-w-0（grid 子项默认 min-width:auto 会把
//     长 alias / 长 placeholder / footer 按钮撑出白卡片）。
//   · DialogFooter 必须 flex-wrap，按钮行不得挤出卡片。
//   · 调用方不得在 DialogContent / AlertDialogContent 上写不受视口约束的
//     固定像素宽度（w-[900px] 这类）；要用 min(...) 或配一个 max-w- clamp。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASH = path.resolve(HERE, '../dashboard');

function walk(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      if (!entry.name.endsWith('.tsx') || entry.name.endsWith('.test.tsx')) return [];
      return [full];
    });
}

interface DialogTag {
  file: string;
  tag: string;
}

function collectDialogTags(): DialogTag[] {
  const files = [...walk(DASH), path.join(HERE, 'alert-dialog.tsx')];
  const tags: DialogTag[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const pattern = /<(DialogContent|AlertDialogContent)([\s\S]{0,700}?)\/?>/g;
    for (const match of source.matchAll(pattern)) {
      tags.push({ file, tag: match[0] });
    }
  }
  return tags;
}

describe('DialogContent 防溢出容器', () => {
  afterEach(cleanup);

  it('基础类收敛宽度并兜底纵向滚动', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>容器</DialogTitle>
            <DialogDescription>检查基础类</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    const content = document.querySelector('[data-slot="dialog-content"]');
    expect(content).not.toBeNull();
    const className = content?.className ?? '';
    expect(className).toContain('min-w-0');
    expect(className).toContain('max-h-[calc(100dvh-2rem)]');
    expect(className).toContain('overflow-x-hidden');
    expect(className).toContain('overflow-y-auto');
    expect(className).toContain('[&>*]:min-w-0');
    expect(className).toContain('max-w-[calc(100%-2rem)]');
    expect(className).toContain('sm:max-w-lg');
  });

  it('DialogFooter 允许换行，按钮行不会挤出卡片', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogFooter data-testid="footer" />
        </DialogContent>
      </Dialog>,
    );

    const footer = document.querySelector('[data-slot="dialog-footer"]');
    const className = footer?.className ?? '';
    expect(className).toContain('flex-wrap');
    expect(className).toContain('min-w-0');
  });
});

describe('弹窗宽度静态扫描', () => {
  it('调用方不使用不受视口约束的固定像素宽度', () => {
    const violations: string[] = [];
    for (const { file, tag } of collectDialogTags()) {
      for (const match of tag.matchAll(/(?<![\w-])((?:[a-z-]+:)?w-\[([^\]]+)\])/g)) {
        const value = match[2].trim();
        if (/^\d+px$/.test(value)) {
          violations.push(`${path.relative(DASH, file)}: ${match[1]}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('固定宽度弹窗同时带有 max-w 或 min() 视口约束', () => {
    const violations: string[] = [];
    for (const { file, tag } of collectDialogTags()) {
      const hasWidthToken = /(?<![\w-])(?:[a-z-]+:)?w-\[[^\]]+\]/.test(tag);
      if (!hasWidthToken) continue;
      const clamped = /(?:[a-z-]+:)?max-w-|w-\[min\(/.test(tag);
      if (!clamped) violations.push(`${path.relative(DASH, file)}: ${tag.trim()}`);
    }
    expect(violations).toEqual([]);
  });

  it('扫描覆盖到实际调用方（防止正则失效后静默通过）', () => {
    expect(collectDialogTags().length).toBeGreaterThan(40);
  });
});
