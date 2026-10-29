import { describe, expect, it, vi } from 'vitest';
import type * as React from 'react';
import {
  handleActivate,
  INTERACTIVE_CARD_CLASS,
  INTERACTIVE_STATES_CLASS,
  INTERACTIVE_SURFACE_CLASS,
} from './interaction-states';

/**
 * 五态配方的存在性断言（方案 v3 A-5）。
 *
 * 这里断的是「配方里确实带了这五个态的类」，不是渲染效果——Tailwind 把类翻成什么样
 * 由构建管，jsdom 也测不出悬停。真正的用处是：有人嫌麻烦从配方里删掉 focus-visible
 * （键盘用户就看不见焦点了）时，这条会红。
 */
const FIVE_STATES: Array<{ name: string; pattern: RegExp }> = [
  { name: 'hover', pattern: /(^|\s)motion-safe:hover:|hover:/ },
  { name: 'active', pattern: /(^|\s)active:/ },
  { name: 'focus-visible', pattern: /(^|\s)focus-visible:ring-/ },
  { name: 'disabled', pattern: /(^|\s)(aria-)?disabled:pointer-events-none/ },
  { name: 'busy', pattern: /(^|\s)aria-busy:cursor-progress/ },
];

describe('交互五态配方', () => {
  for (const recipe of [
    ['INTERACTIVE_SURFACE_CLASS', INTERACTIVE_SURFACE_CLASS],
    ['INTERACTIVE_CARD_CLASS', INTERACTIVE_CARD_CLASS],
  ] as const) {
    const [name, value] = recipe;
    it(`${name} 五态齐全，且焦点环与 Button 同源`, () => {
      for (const state of FIVE_STATES) {
        expect(value, `${name} 缺 ${state.name} 态`).toMatch(state.pattern);
      }
      expect(value).toContain('focus-visible:ring-ring/50');
    });
  }

  it('INTERACTIVE_STATES_CLASS 不带悬停换底色，免得盖掉选中态自己的颜色', () => {
    expect(INTERACTIVE_STATES_CLASS).not.toMatch(/(^|\s)hover:bg-/);
    expect(INTERACTIVE_STATES_CLASS).toMatch(/(^|\s)active:/);
    expect(INTERACTIVE_STATES_CLASS).toMatch(/(^|\s)focus-visible:ring-/);
  });
});

describe('handleActivate', () => {
  function fakeKey(key: string) {
    const event = { key, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLElement>;
    return event;
  }

  it('Enter 与空格都触发，空格先接管默认滚动', () => {
    const onClick = vi.fn();
    const onActivate = handleActivate(onClick);

    const enter = fakeKey('Enter');
    onActivate(enter);
    expect(enter.preventDefault).toHaveBeenCalled();

    const space = fakeKey(' ');
    onActivate(space);
    expect(space.preventDefault).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('其它按键不误触发（比如 Tab 移出、字母键）', () => {
    const onClick = vi.fn();
    const onActivate = handleActivate(onClick);
    for (const key of ['Tab', 'Escape', 'a', 'ArrowDown']) {
      onActivate(fakeKey(key));
    }
    expect(onClick).not.toHaveBeenCalled();
  });
});
