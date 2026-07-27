'use client';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelSelector } from './model-selector';

describe('ModelSelector', () => {
  afterEach(cleanup);

  it('preserves an existing model value as a request model alias', () => {
    render(<ModelSelector value="legacy-provider" onChange={vi.fn()} />);

    expect((screen.getByLabelText('请求模型别名') as HTMLInputElement).value).toBe('legacy-provider');
  });

  it('forwards the entered request model alias unchanged', () => {
    const onChange = vi.fn();
    render(<ModelSelector onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('请求模型别名'), {
      target: { value: 'team-chat' },
    });

    expect(onChange).toHaveBeenCalledWith('team-chat');
  });
});
