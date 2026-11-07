import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './chat-composer';
import { decodeSpeechRecording } from '@/lib/speech-audio';

vi.mock('@/lib/speech-audio', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/speech-audio')>(),
  decodeSpeechRecording: vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2])),
}));

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((_event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}
class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = () => true;
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((_event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeRecorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) });
    queueMicrotask(() => this.onstop?.());
  }
}

const stopTrack = vi.fn();
const getUserMedia = vi.fn();
const onSend = vi.fn();
const originalMedia = navigator.mediaDevices;

function Composer({ roomId = 'room-a' }: { roomId?: string }) {
  const [value, setValue] = useState('@worker 原有草稿');
  return <ChatComposer roomId={roomId} value={value} onChange={setValue} onSend={onSend}
    disabled={false} placeholder="消息" isSending={false} sendError={null} />;
}

beforeEach(() => {
  FakeWorker.instances = [];
  FakeRecorder.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ dashscopeAvailable: false })));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMedia });
});

async function recordAndFinish() {
  fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }));
  await screen.findByRole('button', { name: '完成录音' });
  fireEvent.click(screen.getByRole('button', { name: '完成录音' }));
  await waitFor(() => expect(FakeWorker.instances[0]?.postMessage).toHaveBeenCalled());
}

describe('voice input in the composer', () => {
  it('loads no model initially, appends editable text and sends only on user action', async () => {
    render(<Composer />);
    expect(FakeWorker.instances).toHaveLength(0);
    await recordAndFinish();
    expect(FakeWorker.instances[0].postMessage.mock.calls[0][0]).toMatchObject({ language: 'zh' });
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
    await act(async () => FakeWorker.instances[0].onmessage?.({ data: { type: 'result', text: '檢查 Nacos 配置。' } }));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('@worker 原有草稿 检查 Nacos 配置。'));
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '修改后的文字' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('cancels recognition and ignores late results after switching rooms', async () => {
    const { rerender } = render(<Composer />);
    await recordAndFinish();
    const worker = FakeWorker.instances[0];
    rerender(<Composer roomId="room-b" />);
    expect(worker.terminate).toHaveBeenCalled();
    await act(async () => worker.onmessage?.({ data: { type: 'result', text: '旧房间结果' } }));
    expect(screen.getByRole('textbox')).toHaveValue('@worker 原有草稿');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('cancels a pending permission request and releases a late microphone stream', async () => {
    let resolve!: (_value: unknown) => void;
    getUserMedia.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    render(<Composer />);
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }));
    fireEvent.click(await screen.findByRole('button', { name: '取消语音输入' }));
    await act(async () => resolve({ getTracks: () => [{ stop: stopTrack }] }));
    expect(stopTrack).toHaveBeenCalled();
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(screen.getByRole('textbox')).toHaveValue('@worker 原有草稿');
  });

  it('keeps the draft on permission and recognition failures', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    render(<Composer />);
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('麦克风');
    await recordAndFinish();
    await act(async () => FakeWorker.instances[0].onmessage?.({ data: { type: 'error', error: '识别失败' } }));
    expect(screen.getByRole('alert')).toHaveTextContent('识别失败');
    expect(screen.getByRole('textbox')).toHaveValue('@worker 原有草稿');
  });

  it('stops an active microphone when cancelled without starting recognition', async () => {
    render(<Composer />);
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }));
    await screen.findByRole('button', { name: '完成录音' });
    fireEvent.click(screen.getByRole('button', { name: '取消语音输入' }));
    expect(stopTrack).toHaveBeenCalled();
    expect(FakeRecorder.instances[0].state).toBe('inactive');
    expect(FakeWorker.instances).toHaveLength(0);
    expect(screen.getByRole('textbox')).toHaveValue('@worker 原有草稿');
  });

  it('finishes recording at 60 seconds', async () => {
    vi.useFakeTimers();
    render(<Composer />);
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }));
    await act(async () => {});
    expect(FakeRecorder.instances[0].state).toBe('recording');
    await act(async () => { vi.advanceTimersByTime(60000); });
    expect(FakeRecorder.instances[0].state).toBe('inactive');
    expect(stopTrack).toHaveBeenCalled();
    expect(FakeWorker.instances[0].postMessage).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('explains HTTPS before asking for the microphone', async () => {
    vi.stubGlobal('isSecureContext', false);
    render(<Composer />);
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTPS');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('uses the paid service only after explicit selection, without starting a local worker', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ dashscopeAvailable: true }))
      .mockResolvedValueOnce(Response.json({ text: '百煉轉寫' }));
    render(<Composer />);
    fireEvent.click(screen.getByRole('button', { name: '语音设置' }));
    await waitFor(() => expect(screen.getByRole('option', { name: '百炼（按量付费）' })).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('语音识别方式'), { target: { value: 'dashscope' } });
    fireEvent.keyDown(screen.getByLabelText('语音识别方式'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }));
    fireEvent.click(await screen.findByRole('button', { name: '完成录音' }));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('@worker 原有草稿 百炼转写'));
    expect(FakeWorker.instances).toHaveLength(0);
    expect(vi.mocked(fetch).mock.calls[1][1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'audio/wav' } });
    expect(onSend).not.toHaveBeenCalled();
    expect(decodeSpeechRecording).toHaveBeenCalled();
  });
});
