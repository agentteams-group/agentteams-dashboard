import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeechSettings } from './speech-settings';

const config = { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-asr-flash', apiKeyConfigured: false };
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('speech settings form', () => {
  it('saves from the page and clears the password field after the server accepts it', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(config)).mockResolvedValueOnce(Response.json({ ...config, apiKeyConfigured: true }));
    render(<SpeechSettings canManage />);
    fireEvent.change(await screen.findByLabelText('百炼 API Key'), { target: { value: 'ui-private-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存语音配置' }));
    expect(await screen.findByRole('status')).toHaveTextContent('已保存');
    expect(screen.getByLabelText('百炼 API Key')).toHaveValue('');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ baseUrl: config.baseUrl, model: config.model, apiKey: 'ui-private-key' });
    expect(fetchMock.mock.calls[1][1].method).toBe('PUT');
    expect(screen.getByText('API Key 已配置')).toBeInTheDocument();
  });

  it('preserves the existing key on ordinary saves and offers explicit key removal', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...config, apiKeyConfigured: true }))
      .mockResolvedValueOnce(Response.json({ ...config, apiKeyConfigured: true }))
      .mockResolvedValueOnce(Response.json(config));
    render(<SpeechSettings canManage />);
    await screen.findByLabelText('百炼 API Key');
    fireEvent.click(screen.getByRole('button', { name: '保存语音配置' }));
    await screen.findByRole('status');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('apiKey');
    fireEvent.click(screen.getByRole('button', { name: '移除 API Key' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '移除 API Key' })).toBeDisabled());
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ clearApiKey: true });
  });

  it('does not expose the form or read credentials for non-administrators', () => {
    render(<SpeechSettings canManage={false} />);
    expect(screen.queryByLabelText('百炼 API Key')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prevents saving before configuration loads and supports retrying a failed read', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: '存储不可用' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json(config));
    render(<SpeechSettings canManage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('存储不可用');
    expect(screen.queryByRole('button', { name: '保存语音配置' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载语音配置' }));
    expect(await screen.findByLabelText('百炼 API Key')).toBeInTheDocument();
  });
});
