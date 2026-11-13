import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SectionHeader } from './section-header';

afterEach(cleanup);

it('keeps page title, summary and actions in one responsive toolbar', () => {
  render(<SectionHeader title="任务看板" meta={<div aria-label="任务状态汇总">进行中 3</div>} actions={<button>看板</button>} />);
  const toolbar = screen.getByRole('heading', { name: '任务看板' }).closest('[data-slot="section-header"]')!;
  expect(within(toolbar as HTMLElement).getByLabelText('任务状态汇总')).toBeTruthy();
  expect(within(toolbar as HTMLElement).getByRole('button', { name: '看板' })).toBeTruthy();
});
