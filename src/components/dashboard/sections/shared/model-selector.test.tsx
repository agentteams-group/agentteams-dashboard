'use client';

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelSelector } from './model-selector';
import { TooltipProvider } from '@/components/ui/tooltip';

// Radix Select opens its popover with a Popper that requires ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const options = [
  {
    alias: 'team-chat',
    kind: 'configured' as const,
    binding: {
      requestModelAlias: 'team-chat',
      routeName: 'chat',
      providerName: 'openai',
      targetModel: 'gpt-4.1',
      available: true,
    },
  },
  {
    alias: 'deep-chat',
    kind: 'configured' as const,
    binding: {
      requestModelAlias: 'deep-chat',
      routeName: 'chat',
      providerName: 'deepseek',
      targetModel: 'deepseek-chat',
      available: true,
    },
  },
  { alias: 'deepseek-chat', kind: 'builtin' as const },
];

describe('ModelSelector', () => {
  afterEach(cleanup);

  it('preserves an existing model value as a request model alias', () => {
    render(<TooltipProvider><ModelSelector value="legacy-provider" onChange={vi.fn()} /></TooltipProvider>);

    expect((screen.getByLabelText('请求模型别名') as HTMLInputElement).value).toBe('legacy-provider');
    expect(screen.getByLabelText('自定义请求模型别名说明')).toBeTruthy();
    expect(screen.queryByText(/将由通配符路由或服务端绑定校验处理/)).toBeNull();
  });

  it('forwards the entered custom request model alias unchanged', () => {
    const onChange = vi.fn();
    render(<TooltipProvider><ModelSelector value="legacy-provider" onChange={onChange} /></TooltipProvider>);

    fireEvent.change(screen.getByLabelText('请求模型别名'), {
      target: { value: 'team-chat' },
    });

    expect(onChange).toHaveBeenCalledWith('team-chat');
  });

  it('shows the configured target for a selectable alias', () => {
    render(
      <ModelSelector
        value="team-chat"
        onChange={vi.fn()}
        options={options}
      />,
    );

    expect(screen.getByText('通过路由 chat 转发至 openai / gpt-4.1')).toBeTruthy();
  });

  it('selects an available alias from the dropdown', () => {
    if (!('ResizeObserver' in window)) {
      Object.defineProperty(window, 'ResizeObserver', { value: ResizeObserverStub, configurable: true });
    }
    const onChange = vi.fn();
    render(<ModelSelector value="" onChange={onChange} options={options} />);

    fireEvent.click(screen.getByLabelText('请求模型别名'));
    fireEvent.click(screen.getByRole('option', { name: /deep-chat/ }));

    expect(onChange).toHaveBeenCalledWith('deep-chat');
  });

  it('switches to a custom alias input from the dropdown', () => {
    if (!('ResizeObserver' in window)) {
      Object.defineProperty(window, 'ResizeObserver', { value: ResizeObserverStub, configurable: true });
    }
    const onChange = vi.fn();
    render(<TooltipProvider><ModelSelector value="" onChange={onChange} options={options} /></TooltipProvider>);

    fireEvent.click(screen.getByLabelText('请求模型别名'));
    fireEvent.click(screen.getByRole('option', { name: /自定义别名/ }));

    const input = screen.getByLabelText('请求模型别名') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'my-custom-alias' } });

    expect(onChange).toHaveBeenCalledWith('my-custom-alias');
  });

  it('exits custom alias mode back to the model list', () => {
    if (!('ResizeObserver' in window)) {
      Object.defineProperty(window, 'ResizeObserver', { value: ResizeObserverStub, configurable: true });
    }
    function Controlled() {
      const [value, setValue] = useState('my-unknown-alias');
      return <TooltipProvider><ModelSelector value={value} onChange={setValue} options={options} /></TooltipProvider>;
    }
    render(<Controlled />);

    // Unknown alias value puts the component in custom input mode.
    expect((screen.getByLabelText('请求模型别名') as HTMLInputElement).value).toBe('my-unknown-alias');

    fireEvent.click(screen.getByRole('button', { name: '从列表选择' }));

    // Back to the dropdown: the text input is gone, the Select trigger is shown.
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: /team-chat/ })).toBeTruthy();
  });

  it('marks a SGLang serving model with its source badge and hint', () => {
    if (!('ResizeObserver' in window)) {
      Object.defineProperty(window, 'ResizeObserver', { value: ResizeObserverStub, configurable: true });
    }
    const sglangOptions = [
      { alias: 'qwen3.6-27b-fp8', kind: 'sglang' as const },
      { alias: 'deepseek-chat', kind: 'builtin' as const },
    ];
    render(<ModelSelector value="qwen3.6-27b-fp8" onChange={vi.fn()} options={sglangOptions} />);

    expect(screen.getByText(/SGLang 推理服务在线模型；请求按模型名经 AI 网关路由至本地推理服务/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('请求模型别名'));
    expect(screen.getByRole('option', { name: /SGLang 推理服务在线模型，经 AI 网关路由转发/ })).toBeTruthy();
  });

  it('marks an unconfigured built-in model alias in the dropdown', () => {
    if (!('ResizeObserver' in window)) {
      Object.defineProperty(window, 'ResizeObserver', { value: ResizeObserverStub, configurable: true });
    }
    render(<ModelSelector value="deepseek-chat" onChange={vi.fn()} options={options} />);

    fireEvent.click(screen.getByLabelText('请求模型别名'));
    expect(screen.getByRole('option', { name: /内置模型，需在「模型管理」配置路由映射/ })).toBeTruthy();
    expect(screen.getByText(/内置模型别名，请求经 AI 网关 Consumer 凭证转发/)).toBeTruthy();
  });
});
