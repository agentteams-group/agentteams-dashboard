import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Combobox } from './combobox';
import { Dialog, DialogContent, DialogTitle } from './dialog';

// Radix Popover 定位用 floating-ui，jsdom 下需要 ResizeObserver。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in window)) {
  Object.defineProperty(window, 'ResizeObserver', {
    value: ResizeObserverStub,
    configurable: true,
  });
}

const OPTIONS = ['higress', 'openai-ark', 'deepseek'];

function Harness({
  initial = '',
  allowCustom = true,
  disabled = false,
  options = OPTIONS,
  portal = false,
}: {
  initial?: string;
  allowCustom?: boolean;
  disabled?: boolean;
  options?: string[];
  portal?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <Combobox
        value={value}
        options={options}
        onChange={setValue}
        ariaLabel="候选字段"
        placeholder="选择或输入"
        allowCustom={allowCustom}
        disabled={disabled}
        portal={portal}
      />
      <output data-testid="value">{value}</output>
    </div>
  );
}

function field() {
  return screen.getByLabelText('候选字段') as HTMLInputElement;
}

describe('Combobox（可搜索 + 可自由输入）', () => {
  afterEach(cleanup);

  it('keeps a portalled candidate list outside clipping containers and selects with the keyboard', () => {
    const { container } = render(<Harness portal />);
    fireEvent.focus(field());
    expect(container.contains(screen.getByRole('listbox'))).toBe(false);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(field()).toHaveValue('higress');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes the portalled list with Escape without dismissing its parent dialog', () => {
    const onKeyDown = vi.fn();
    render(<div onKeyDown={onKeyDown}><Harness portal /></div>);
    fireEvent.focus(field());
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('reopens after selecting in a dialog, then Escape dismisses only the list', () => {
    const onOpenChange = vi.fn();
    render(<Dialog open onOpenChange={onOpenChange}><DialogContent aria-describedby={undefined}><DialogTitle>模型配置</DialogTitle><Harness portal /></DialogContent></Dialog>);
    fireEvent.focus(field());
    fireEvent.mouseDown(screen.getByRole('option', { name: 'deepseek' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(field());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('聚焦后展示全部候选', () => {
    render(<Harness />);
    fireEvent.focus(field());

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(OPTIONS);
    expect(field()).toHaveAttribute('aria-expanded', 'true');
  });

  it('键入即过滤候选，并保留自由输入值', () => {
    render(<Harness />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: 'dee' } });

    expect(screen.getByRole('option', { name: 'deepseek' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'higress' })).toBeNull();
    // 候选不收敛也必须保留手填值（无候选时列表收起，不是清空）。
    fireEvent.change(field(), { target: { value: 'my-custom-model' } });
    expect(screen.getByTestId('value')).toHaveTextContent('my-custom-model');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('点击候选 → 写回 value 并收起列表', () => {
    render(<Harness />);
    fireEvent.focus(field());
    fireEvent.click(screen.getByRole('option', { name: 'openai-ark' }));

    expect(screen.getByTestId('value')).toHaveTextContent('openai-ark');
    expect(field()).toHaveValue('openai-ark');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('清空输入 → value 变为空串', () => {
    render(<Harness initial="higress" />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: '' } });

    expect(screen.getByTestId('value').textContent).toBe('');
  });

  it('当前值在候选中高亮（aria-selected）', () => {
    render(<Harness initial="deepseek" />);
    fireEvent.focus(field());

    expect(screen.getByRole('option', { name: 'deepseek' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: 'higress' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('键盘 ↑↓ + Enter 选中候选', () => {
    render(<Harness />);
    fireEvent.focus(field());

    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(screen.getByTestId('value')).toHaveTextContent('higress');
  });

  it('未用方向键时 Enter 提交自由输入（不劫持手填值）', () => {
    render(<Harness />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: 'hig' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(screen.getByTestId('value')).toHaveTextContent('hig');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Esc 收起列表但保留已提交的值', () => {
    render(<Harness initial="higress" />);
    fireEvent.focus(field());
    fireEvent.keyDown(field(), { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByTestId('value')).toHaveTextContent('higress');
  });

  it('allowCustom=false：键入只过滤，不失焦提交', () => {
    render(<Harness allowCustom={false} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: 'dee' } });

    expect(screen.getByTestId('value').textContent).toBe('');
    fireEvent.blur(field());
    expect(field()).toHaveValue('');
  });

  it('disabled 时不弹候选', () => {
    render(<Harness disabled />);
    fireEvent.focus(field());

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field()).toBeDisabled();
  });

  it('options 去重并忽略空串', () => {
    const onChange = vi.fn();
    render(
      <Combobox
        value=""
        options={['a', 'a', '', 'b']}
        onChange={onChange}
        ariaLabel="去重字段"
      />,
    );
    fireEvent.focus(screen.getByLabelText('去重字段'));

    expect(screen.getAllByRole('option')).toHaveLength(2);
  });
});
