import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { LOCAL_PROVIDER, ModelPicker } from './model-picker';

const providers = ['provider-a', 'provider-b'];
const modelsByProvider = {
  'provider-a': ['a-model-1', 'a-model-2'],
  'provider-b': ['b-model-1'],
};
const allModels = ['a-model-1', 'a-model-2', 'b-model-1', 'builtin-model'];

function Harness({
  initialProvider = '',
  initialModel = '',
  onChange,
}: {
  initialProvider?: string;
  initialModel?: string;
  onChange?: (_provider: string, _model: string) => void;
}) {
  const [provider, setProvider] = useState(initialProvider);
  const [model, setModel] = useState(initialModel);
  return (
    <ModelPicker
      providers={providers}
      provider={provider}
      model={model}
      modelsByProvider={modelsByProvider}
      allModels={allModels}
      onChange={(nextProvider, nextModel) => {
        setProvider(nextProvider);
        setModel(nextModel);
        onChange?.(nextProvider, nextModel);
      }}
    />
  );
}

function openList(input: HTMLElement): HTMLElement {
  fireEvent.focus(input);
  return within(input.parentElement as HTMLElement).getByRole('listbox');
}

describe('ModelPicker', () => {
  afterEach(cleanup);

  it('先 Provider 后 Model 渲染两个可搜索控件', () => {
    render(<Harness />);
    const provider = screen.getByLabelText('模型连接');
    const model = screen.getByLabelText('模型');
    expect(provider.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('模型连接')).toBeInTheDocument();
    expect(screen.getByText('模型')).toBeInTheDocument();
  });

  it('空 provider 显示哨兵，模型候选为全量', () => {
    render(<Harness />);
    const provider = screen.getByLabelText('模型连接') as HTMLInputElement;
    expect(provider).toHaveValue(LOCAL_PROVIDER);

    const list = openList(screen.getByLabelText('模型'));
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(allModels);
  });

  it('选择 Provider 后模型候选只剩该 Provider 的模型', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const provider = screen.getByLabelText('模型连接');
    fireEvent.click(within(openList(provider)).getByRole('option', { name: 'provider-a' }));
    expect(onChange).toHaveBeenLastCalledWith('provider-a', '');

    const list = openList(screen.getByLabelText('模型'));
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(modelsByProvider['provider-a']);
  });

  it('换 Provider 时清空不属于新 Provider 的旧模型', () => {
    const onChange = vi.fn();
    render(
      <Harness initialProvider="provider-a" initialModel="a-model-1" onChange={onChange} />,
    );
    const provider = screen.getByLabelText('模型连接');
    fireEvent.click(within(openList(provider)).getByRole('option', { name: 'provider-b' }));
    expect(onChange).toHaveBeenLastCalledWith('provider-b', '');
  });

  it('切回哨兵 = 无 provider，模型候选恢复全量且保留兼容模型', () => {
    const onChange = vi.fn();
    render(
      <Harness initialProvider="provider-b" initialModel="b-model-1" onChange={onChange} />,
    );
    const provider = screen.getByLabelText('模型连接');
    fireEvent.click(within(openList(provider)).getByRole('option', { name: LOCAL_PROVIDER }));
    expect(onChange).toHaveBeenLastCalledWith('', 'b-model-1');

    const list = openList(screen.getByLabelText('模型'));
    expect(within(list).getAllByRole('option')).toHaveLength(allModels.length);
  });

  it('未知的当前模型仍显示在输入框并保留在候选中', () => {
    render(<Harness initialProvider="provider-a" initialModel="legacy-model" />);
    const model = screen.getByLabelText('模型') as HTMLInputElement;
    expect(model).toHaveValue('legacy-model');
    const list = openList(model);
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toContain('legacy-model');
  });

  it('允许自由输入 provider/model', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const provider = screen.getByLabelText('模型连接');
    fireEvent.change(provider, { target: { value: 'custom-provider' } });
    expect(onChange).toHaveBeenLastCalledWith('custom-provider', '');

    const model = screen.getByLabelText('模型');
    fireEvent.change(model, { target: { value: 'custom-model' } });
    expect(onChange).toHaveBeenLastCalledWith('custom-provider', 'custom-model');
  });
});
