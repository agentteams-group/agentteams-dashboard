import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { MobileSidebar } from './mobile-sidebar';

vi.mock('./workspace-navigation', () => ({
  WorkspaceNavigation: ({ onNavClick }: { onNavClick: (_id: string) => void }) => (
    <button type="button" onClick={() => onNavClick('files')}>文件</button>
  ),
}));

afterEach(cleanup);

function Harness() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return <>
    <button ref={triggerRef} type="button" aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(true)}>打开导航菜单</button>
    <MobileSidebar open={open} onOpenChange={setOpen} onClose={() => setOpen(false)} triggerRef={triggerRef} activeSection="overview" countMap={{}} sectionsWithNotifications={new Set()} onNavClick={() => setOpen(false)} />
  </>;
}

describe('MobileSidebar', () => {
  it('uses modal semantics, closes with Escape and restores trigger focus', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '打开导航菜单' });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'AgentTeams 导航' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '打开导航菜单' }));
    await screen.findByRole('dialog');
    const result = await axe.run(container, { resultTypes: ['violations'] });
    expect(result.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);
  });
});
