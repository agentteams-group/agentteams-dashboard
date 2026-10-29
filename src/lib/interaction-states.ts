/**
 * 交互五态的同一套写法（方案 v3 A-5）。
 *
 * 一个「能用的东西」在五个时刻都要看得出状态：悬停（hover）、按下（active）、
 * 键盘聚焦（focus-visible）、禁用（disabled）、正在忙（loading / aria-busy）。
 * `Button` 基元本来就有 hover / focus-visible / disabled，缺按下和「忙」；房间项、
 * 任务卡这类自己拼 className 的可点面各有各的子集，最常见的后果是键盘用户
 * Tab 上去看不出焦点在哪（房间项只有 `hover:bg-accent` + framer 的 whileTap）。
 *
 * 所以这里把「一个可点面」该带的五个状态收成一处，样式值仍走主题变量
 * （`--ring` / `--background`），不改任何颜色口径；`Button` 的焦点环与这里的
 * 是同一套（`ring-ring/50` + 3px），从哪儿聚焦看起来都一样。
 */

/**
 * 非 `Button` 的可点面里，除悬停以外的四态（按下、键盘聚焦、禁用、正在忙）。
 *
 * 单独拆出来是因为选中态通常自带底色（当前房间是 emerald 淡底）：跟通用
 * `hover:bg-accent` 撞在同一个元素上，谁生效取决于样式表顺序，看不出来也调不动。
 * 悬停由调用方按「未选中才换底色」自己写。
 */
export const INTERACTIVE_STATES_CLASS = [
  // 只动颜色与位移，过渡时长跟 Button 的 transition-all 同量级。
  'transition-[background-color,border-color,box-shadow,transform] duration-150',
  // 按下：与 Button 的 active 一致，1px 的回坐。
  'active:translate-y-px active:duration-75',
  // 键盘聚焦：和 Button 用同一枚焦点环（--ring，3px，配 offset 才在玻璃底上看得见）。
  'outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
  // 禁用：既不响应指针，也给出可辨的褪色。
  'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
  // 忙：光标先说明「点了有用，只是还没完」，避免用户连点。
  'aria-busy:cursor-progress',
].join(' ');

/**
 * 完整五态（含悬停换底色），给没有选中态概念的可点面用。
 */
export const INTERACTIVE_SURFACE_CLASS = [
  INTERACTIVE_STATES_CLASS,
  // 悬停
  'hover:bg-accent hover:text-accent-foreground',
].join(' ');

/**
 * 可点卡片的五态（任务卡、项目卡）。
 *
 * 卡片的反馈放在位移和边框上，不能像行那样换底色：`glass-card` 的底是
 * `--card-glass`（半透 + 毛玻璃），hover 一旦换成 `--accent`，玻璃质感就跳没了。
 * `.hover-lift` 只给了悬停抬起，没有键盘焦点 / 按下 / 禁用，而且任务卡本身是个
 * `div`：键盘根本走不到它上面，Tab 过去也看不出焦点在哪——这一步才是要补的。
 */
export const INTERACTIVE_CARD_CLASS = [
  'cursor-pointer transition-[transform,box-shadow,border-color] duration-200',
  // 悬停：抬起 2px，跟 `.hover-lift` 一致；只给愿意动的人（motion-safe）。
  'motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-[var(--elevation-card)]',
  // 按下：坐回原位，比悬停更短。
  'active:translate-y-0 active:duration-75',
  // 键盘聚焦：和 Button 同一枚焦点环。
  'outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
  // 禁用 / 忙：卡片没有原生 disabled，用 aria 那一对。
  'aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-busy:cursor-progress',
].join(' ');

/**
 * 可点面的选中态（当前房间、选中的 worker、展开的任务卡）。
 *
 * 用 emerald 而不是 `--primary`：这台机器的 `--primary` 是近黑 / 近白（高对比
 * 主题是黄），选中底色会整个变掉；emerald 是本产品一路在用的强调色（消息气泡
 * 自己那侧、房间图标都是它），A-1 收敛的是六个运行状态色，不含品牌强调色。
 */
export const SELECTED_SURFACE_CLASS = 'bg-emerald-500/10 border-emerald-500/30';

/**
 * 给一个 div 补上按钮的键盘语义：Enter 与空格都触发（空格还要 preventDefault，
 * 否则页面会先滚一段）。用法：
 * `onKeyDown={handleActivate(onClick)}`，并配 `role="button" tabIndex={0}`。
 */
export function handleActivate(onClick: () => void) {
  return function HandleActivate(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    // 空格落在滚动容器上会默认翻页，这里替浏览器接管。
    event.preventDefault();
    onClick();
  };
}
