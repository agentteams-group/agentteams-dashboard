import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { StatusDot } from './status-dot';

afterEach(cleanup);

describe('StatusDot v2 (color + shape double encoding, AC-T3)', () => {
  it('renders a circle for green phases', () => {
    const { container } = render(<StatusDot phase="Running" />);
    expect(screen.getByRole('img', { name: 'Running' })).toBeInTheDocument();
    expect(container.querySelector('span.rounded-full.bg-current')).not.toBeNull();
  });

  it('renders a triangle for amber phases', () => {
    const { container } = render(<StatusDot phase="Sleeping" />);
    expect(container.querySelector('svg path[fill="currentColor"]')).not.toBeNull();
  });

  it('renders an X for red phases', () => {
    const { container } = render(<StatusDot phase="Failed" />);
    expect(container.querySelector('svg path[stroke="currentColor"]')).not.toBeNull();
  });

  it('renders a square for stopped', () => {
    const { container } = render(<StatusDot phase="Stopped" />);
    expect(container.querySelector('svg rect')).not.toBeNull();
  });

  it('uses per-phase animation timing classes', () => {
    const { container: running } = render(<StatusDot phase="Running" />);
    expect(running.querySelector('.status-dot-green')).not.toBeNull();
    const { container: sleeping } = render(<StatusDot phase="Sleeping" />);
    expect(sleeping.querySelector('.status-dot-amber-slow')).not.toBeNull();
    const { container: pending } = render(<StatusDot phase="Pending" />);
    expect(pending.querySelector('.status-dot-amber-fast')).not.toBeNull();
    const { container: failed } = render(<StatusDot phase="Failed" />);
    expect(failed.querySelector('.status-dot-red-fast')).not.toBeNull();
    const { container: stopped } = render(<StatusDot phase="Stopped" />);
    expect(stopped.querySelector('[class*="status-dot"]')).toBeNull();
  });
});
