import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLUMN_TRACK, columnsFor, effectiveLayoutMode, listGrid, panesFor } from './files-model';

// 触屏 / 鼠标 / 横竖屏 / 深浅色适配的静态门（本批新增页面的审计口径）。
//
// 口径说明：
//   · 44px 契约落在 UI 原子层（Button / SelectTrigger / SelectItem / Input /
//     对话框关闭按钮），页面层不得用无前缀（触控层）的 h-1~h-7 / size-1~size-8
//     把命中区压回去；`sm:` / `md:` 前缀的收缩是桌面视觉密度，允许。
//   · 树展开箭头这类「24px 视觉 + after: 伪元素扩到 44」的写法走白名单。
//   · 颜色只准语义 token（--color-status-* / background / muted / border），
//     禁止具体色板（amber/emerald/red-N/sky/violet）与 #fff/#000/bg-white/gray-*。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const DASH = path.join(SRC, 'components/dashboard');
const UI = path.join(SRC, 'components/ui');

const AUDITED = [
  'sections/workers/worker-drawer.tsx',
  'sections/workers/worker-qwen-code-bridge-card.tsx',
  'sections/files-section.tsx',
  'sections/files/file-detail.tsx',
  'sections/files/file-drop-target.tsx',
  'sections/files/file-search-results.tsx',
  'sections/files/file-views.tsx',
  'sections/files/files-dialogs.tsx',
  'sections/files/trash-dialog.tsx',
  'sections/files/upload-panel.tsx',
  'sections/teams/team-drawer.tsx',
  'sections/teams/team-skills-panel.tsx',
  'sections/humans/human-drawer.tsx',
  'sections/humans/human-access-dialog.tsx',
  'sections/humans/human-create-dialog.tsx',
  'sections/humans/human-delete-dialog.tsx',
  'sections/humans/human-detail-dialog.tsx',
  'sections/humans/human-edit-dialog.tsx',
  'sections/humans/human-model-access-dialog.tsx',
  'sections/humans/human-quota-dialog.tsx',
  'sections/humans/human-workspace-access-dialog.tsx',
  'sections/humans/team-access-field.tsx',
  'sections/shared/member-picker.tsx',
  'settings/backend-tab.tsx',
  'sections/projects/meta-editor.tsx',
];

function readAt(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), 'utf-8');
}

function read(rel: string): string {
  return readAt(DASH, rel);
}

/** 取某标签名的所有「开标签」文本：引号 / {} 内的 `>` 不算结束。 */
function openingTags(source: string, tag: string): string[] {
  const needle = `<${tag}`;
  const out: string[] = [];
  let index = source.indexOf(needle);
  while (index !== -1) {
    const boundary = source[index + needle.length];
    if (boundary !== undefined && /[\s/>]/.test(boundary)) {
      let cursor = index + needle.length;
      let quote: string | null = null;
      let braces = 0;
      for (; cursor < source.length; cursor += 1) {
        const ch = source[cursor];
        if (quote) {
          if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
          quote = ch;
          continue;
        }
        if (ch === '{') braces += 1;
        else if (ch === '}') braces -= 1;
        else if (ch === '>' && braces === 0) break;
      }
      out.push(source.slice(index, cursor + 1));
    }
    index = source.indexOf(needle, index + needle.length);
  }
  return out;
}

/** 开标签里出现的全部 className 文本（字符串 / 模板串 / cn(...) 原样拼接）。 */
function classNames(tag: string): string {
  const parts: string[] = [];
  for (const match of tag.matchAll(/className="([^"]*)"/g)) parts.push(match[1]);
  for (const match of tag.matchAll(/className=\{`([^`]*)`\}/g)) parts.push(match[1]);
  for (const match of tag.matchAll(/className=\{cn\(([\s\S]*?)\)\}/g)) parts.push(match[1]);
  return parts.join(' ');
}

/** 触控层（不带 sm: / md: / max- / dark: 前缀）的高度类。 */
function touchHeightTokens(tag: string): string[] {
  return classNames(tag)
    .split(/\s+/)
    .filter((token) => token !== '' && !token.includes(':'))
    .filter((token) => /^h-\d+$/.test(token) || /^size-\d+$/.test(token));
}

const UNDERSIZED = /^(h-[1-7]|size-[1-8])$/;
const HIT_AREA_ESCAPE = /(min-h-11|h-11|size-11|after:-inset)/;

describe('UI 原子层：44px 触控契约', () => {
  it('Button 在窄屏保证 44×44（含 size="icon"），桌面回落视觉尺寸', () => {
    const button = readAt(UI, 'button.tsx');
    expect(button).toMatch(/min-h-11/);
    expect(button).toMatch(/min-w-11/);
    expect(button).toMatch(/sm:min-h-0/);
    expect(button).toMatch(/sm:min-w-0/);
  });

  it('SelectTrigger / SelectItem / Input 在窄屏保证 44 高', () => {
    const select = readAt(UI, 'select.tsx');
    // trigger：默认与 size="sm" 两个 data-size 分支都要有 44
    expect(select).toMatch(/flex min-h-11 w-fit/);
    expect(select).toMatch(/sm:data-\[size=sm\]:min-h-8/);
    // item：点选行同样 44
    expect(select).toMatch(/flex min-h-11 w-full cursor-default/);
    expect(readAt(UI, 'input.tsx')).toMatch(/flex h-9 min-h-11 w-full/);
  });

  it('对话框 / 抽屉关闭按钮为 44×44 且标题区让位', () => {
    const dialog = readAt(UI, 'dialog.tsx');
    expect(dialog).toMatch(/absolute top-2 right-2 flex size-11/);
    expect(dialog).toMatch(/gap-2 pr-10 text-center/);
    const sheet = readAt(UI, 'sheet.tsx');
    expect(sheet).toMatch(/absolute top-2 right-2 flex size-11/);
    expect(sheet).toMatch(/gap-1\.5 p-4 pr-12/);
  });

  it('下拉菜单项在窄屏 44 高（详情 / 重命名 / 删除等行内菜单）', () => {
    const menu = readAt(UI, 'dropdown-menu.tsx');
    expect(menu.match(/min-h-11/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe('审计页：交互元素不得在触控层压回 44 以下', () => {
  it.each(AUDITED)('%s', (rel) => {
    const source = read(rel);
    const violations: string[] = [];
    for (const tag of ['Button', 'button', 'SelectTrigger']) {
      for (const block of openingTags(source, tag)) {
        const classes = classNames(block);
        if (HIT_AREA_ESCAPE.test(classes)) continue;
        const undersized = touchHeightTokens(block).filter((token) => UNDERSIZED.test(token));
        if (undersized.length > 0) violations.push(`<${tag}> ${undersized.join(' ')}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('行内多个操作按钮间距 ≥8px（gap-2 起）', () => {
    const views = read('sections/files/file-views.tsx');
    expect(views).toMatch(/flex items-center justify-end gap-2/);
    expect(views).not.toMatch(/flex items-center justify-end gap-1"/);
  });

  it('图标按钮均带 aria-label', () => {
    const missing: string[] = [];
    for (const rel of AUDITED) {
      for (const block of openingTags(read(rel), 'Button')) {
        if (!/size="icon"/.test(block)) continue;
        if (!/aria-label=/.test(block)) missing.push(`${rel}: ${block.slice(0, 80)}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('横竖屏：375×812 / 812×375 契约', () => {
  it('团队抽屉窄屏 w-full，560px 只在 sm+ 生效', () => {
    const drawer = read('sections/teams/team-drawer.tsx');
    expect(drawer).toMatch(/w-full gap-0 overflow-x-hidden p-0 sm:w-\[560px\] sm:max-w-\[560px\]/);
  });

  it('人员抽屉窄屏 w-full，480px 只在 sm+ 生效', () => {
    const drawer = read('sections/humans/human-drawer.tsx');
    expect(drawer).toMatch(/w-full gap-0 overflow-x-hidden p-0 sm:max-w-\[480px\]/);
  });

  it('Worker 抽屉与资源大弹窗窄屏全屏 + 内容独立滚动', () => {
    const drawer = read('sections/workers/worker-drawer.tsx');
    // 抽屉本体：窄屏全宽，sm+ 才收成 560
    expect(drawer).toMatch(/w-full max-w-none[^"]*sm:w-\[min\(92vw,560px\)\]/);
    // 资源大弹窗：max-sm 全屏、圆角归零、body 独立滚动
    expect(drawer).toMatch(/max-sm:h-\[100dvh\] max-sm:w-full max-sm:max-w-none max-sm:rounded-none/);
    expect(drawer).toMatch(/min-h-0 flex-1 overflow-y-auto px-5 py-4/);
  });

  it('文件详情浮层：抽屉形态留 92vw 上限，底部表单不留横向溢出', () => {
    const section = read('sections/files-section.tsx');
    expect(section).toMatch(/h-full w-\[420px\] max-w-\[92vw\]/);
    expect(section).toMatch(/max-h-\[85vh\] w-full rounded-t-xl/);
    // 工具条 / 搜索区一律 flex-wrap，375 下不出横向滚动
    expect(section).toMatch(/flex flex-wrap items-end justify-between gap-3/);
    expect(section).toMatch(/flex w-full min-w-0 flex-col gap-1 sm:w-\[280px\]/);
  });

  it('长表单弹窗有高度上限与内部滚动（创建人员 / 回收站 / meta）', () => {
    expect(read('sections/humans/human-create-dialog.tsx')).toMatch(/max-h-\[90dvh\] overflow-y-auto/);
    expect(read('sections/files/trash-dialog.tsx')).toMatch(/flex max-h-\[85vh\] flex-col/);
    expect(read('sections/projects/meta-editor.tsx')).toMatch(/max-h-\[85vh\] overflow-y-auto/);
    for (const rel of [
      'sections/humans/human-access-dialog.tsx',
      'sections/humans/human-model-access-dialog.tsx',
      'sections/humans/human-workspace-access-dialog.tsx',
    ]) {
      expect(read(rel)).toMatch(/max-h-\[6\dvh\][\s\S]{0,80}overflow-y-auto/);
    }
  });
});

describe('深色 / 浅色：只用语义色 token', () => {
  const FORBIDDEN = /\b(?:bg-white|text-black|gray-\d{2,3}|amber-\d{2,3}|emerald-\d{2,3}|red-\d{2,3}|sky-\d{2,3}|violet-\d{2,3}|green-\d{2,3}|blue-\d{2,3}|slate-\d{2,3})\b/;

  it.each(AUDITED)('%s 不含具体色板 / #fff / #000', (rel) => {
    const source = read(rel);
    expect(source.match(FORBIDDEN)?.[0]).toBeUndefined();
    expect(source).not.toMatch(/#fff\b|#ffffff\b|#000\b|#000000\b/i);
  });

  it('状态色走 --color-status-* 语义 token', () => {
    expect(read('sections/workers/worker-qwen-code-bridge-card.tsx')).toMatch(/text-status-waiting/);
    expect(read('sections/teams/team-drawer.tsx')).toMatch(/text-status-done/);
    expect(read('settings/backend-tab.tsx')).toMatch(/text-status-failed/);
    expect(read('sections/files/upload-panel.tsx')).toMatch(/text-status-done/);
  });
});

describe('鼠标 / 键盘：可点行与焦点可见', () => {
  it('文件行 cursor-pointer + hover 与选中态区分 + focus-visible 环', () => {
    const views = read('sections/files/file-views.tsx');
    expect(views).toMatch(/grid min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm/);
    expect(views).toMatch(/focused \? 'bg-primary\/10' : 'hover:bg-accent\/40'/);
    expect(views).toMatch(/focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none/);
    expect(views).not.toMatch(/cursor-default items-center/);
  });

  it('搜索结果行可点 + 焦点环', () => {
    const results = read('sections/files/file-search-results.tsx');
    expect(results).toMatch(/grid min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm/);
    expect(results).toMatch(/focus-visible:ring-2 focus-visible:ring-ring/);
  });

  it('复选框 / 开关命中区包到 44（文件三视图 + 技能矩阵 + peerMentions）', () => {
    const views = read('sections/files/file-views.tsx');
    expect(views.match(/label className="flex size-11 items-center justify-center"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(read('sections/teams/team-skills-panel.tsx')).toMatch(/label className="flex size-11 items-center justify-center"/);
    expect(read('sections/teams/team-drawer.tsx')).toMatch(/flex min-h-11 items-center gap-2">\s*<Switch/);
    expect(read('sections/shared/member-picker.tsx')).toMatch(/inline-flex min-h-11/);
  });

  it('抽屉 / 弹窗标题由 Radix SheetTitle / DialogTitle 提供 aria-labelledby', () => {
    expect(read('sections/teams/team-drawer.tsx')).toMatch(/<SheetTitle/);
    expect(read('sections/humans/human-drawer.tsx')).toMatch(/<SheetTitle/);
    expect(read('sections/workers/worker-drawer.tsx')).toMatch(/<DialogTitle/);
  });
});

describe('文件页 375 宽：只剩名称 + 操作，操作收「更多」，批量条留在流内', () => {
  it('列分档：375 下收 size/type/modified，操作列宽 44', () => {
    const narrow = columnsFor(375, false);
    expect(narrow.compactActions).toBe(true);
    expect(narrow.columns).toEqual(['name', 'more']);
    expect(narrow.showSize).toBe(false);
    expect(narrow.showUpdatedAt).toBe(false);
    expect(COLUMN_TRACK.more).toBe('44px');
    expect(COLUMN_TRACK.select).toBe('44px');
    expect(listGrid(narrow.columns)).toContain('44px');

    const narrowMulti = columnsFor(375, true);
    expect(narrowMulti.columns).toEqual(['select', 'name', 'more']);

    const wide = columnsFor(1200, false);
    expect(wide.compactActions).toBe(false);
    expect(wide.columns).toEqual(['name', 'size', 'type', 'modified', 'actions']);
  });

  it('三视图在 375 走 sheet 浮层（不挤压列表）', () => {
    const mode = effectiveLayoutMode({ containerWidth: 375, listWidth: 375, listMeasured: true });
    expect(mode).toBe('sheet');
    expect(panesFor(mode, true)).toEqual({ list: 'list', detail: null, overlay: 'sheet' });
  });

  it('批量条 sticky 且在文档流内（不遮最后一行）、按钮 44 起', () => {
    const section = read('sections/files-section.tsx');
    expect(section).toMatch(/sticky bottom-2 z-10 flex flex-wrap items-center gap-2/);
    expect(section).toMatch(/min-h-11 sm:min-h-9" onClick=\{\(\) => void batchDownload\(\)\}/);
  });

  it('操作列在窄档只渲染「更多」菜单（不再并排三个图标按钮）', () => {
    const views = read('sections/files/file-views.tsx');
    expect(views).toMatch(/columns\.compactActions \? \(\s*<ActionsMenu/);
  });
});
