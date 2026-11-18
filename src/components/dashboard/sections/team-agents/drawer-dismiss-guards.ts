'use client';

/**
 * 真抽屉与分区弹窗共存时的 dismiss 守卫（单一实现）。
 *
 * 背景：抽屉用 `modal={false}`（真抽屉，非模态），Radix 的 DismissableLayer
 * 会在「弹窗抢焦点 / 点击 / 交互」时把抽屉一起 dismiss。工作台 dual 右栏与
 * 卡片编辑抽屉是同一形态，所以守卫抽在这里，两处共用（禁各写一份）。
 *
 * 语义：`locked` = 分区弹窗是否打开；打开期间屏蔽三种外部 dismiss，
 * 弹窗关闭后恢复默认行为（点抽屉外面仍可关抽屉）。
 */
export function drawerDismissGuards(locked: boolean) {
  const guard = (event: { preventDefault: () => void }) => {
    if (locked) event.preventDefault();
  };
  return { onInteractOutside: guard, onPointerDownOutside: guard, onFocusOutside: guard };
}
