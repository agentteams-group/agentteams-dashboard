import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HealthRing, HealthRingCompact } from './health-ring';

/**
 * 回归门（罗总两轮实测）：
 * ① 分数数字必须和环在同一个 relative 盒子里——否则 absolute 会跑到别的
 *    定位祖先上，看起来「数字没跟着环走」；
 * ② 数字字号随环直径缩放——小环（成员健康 24px）里 100 三个字符不许溢出压字。
 */
afterEach(cleanup);

describe('HealthRing', () => {
  it('把分数钉在环内（定位父级相同）且字号随直径缩放', () => {
    render(<HealthRing score={100} size={56} strokeWidth={4} label="健康" />);
    const score = screen.getByText('100');
    expect(score.parentElement).toHaveClass('relative');
    expect(score).toHaveStyle({ fontSize: '19px' });
    expect(screen.getByText('健康')).toBeInTheDocument();
  });

  it('大环字号有上限（不超过 20px），小环有下限（不低于 8px）', () => {
    const { unmount } = render(<HealthRing score={90} size={200} />);
    expect(screen.getByText('90')).toHaveStyle({ fontSize: '20px' });
    unmount();
    render(<HealthRing score={90} size={10} />);
    expect(screen.getByText('90')).toHaveStyle({ fontSize: '8px' });
  });

  it('Compact 环（24px）同样居中且字号放得下 100', () => {
    render(<HealthRingCompact score={100} size={24} />);
    const score = screen.getByText('100');
    expect(score).toHaveClass('absolute', 'inset-0');
    expect(score).toHaveStyle({ fontSize: '9px' });
  });
});
