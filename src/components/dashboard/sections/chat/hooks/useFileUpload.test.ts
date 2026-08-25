import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatSystemNotice } from '../structures/MessageList';
import { useFileUpload } from './useFileUpload';

function makeHarness() {
  const pushLocal = vi.fn();
  const patchLocal = vi.fn();
  const removeLocal = vi.fn();
  const pushSystemNotice = vi.fn();
  const upload = vi.fn(async () => ({ content_uri: 'mxc://example/abc' }));
  const send = vi.fn();
  const buildSystemNotice = vi.fn(
    (err: unknown, payload: { content: string }, counter: number): ChatSystemNotice => ({
      id: counter,
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
      createdAt: Date.now(),
      autoRetry: false,
      retryPayload: payload,
    }),
  );

  const input = {
    roomId: '!room:example',
    isLoggedIn: true,
    userId: '@alice:example',
    upload,
    send,
    pushLocal,
    patchLocal,
    removeLocal,
    pushSystemNotice,
    buildSystemNotice,
  };
  return { input, pushLocal, patchLocal, removeLocal, pushSystemNotice, upload, send, buildSystemNotice };
}

describe('useFileUpload', () => {
  it('uploads then sends m.image for image files', async () => {
    const h = makeHarness();
    const { result } = renderHook(() => useFileUpload(h.input));
    const file = new File(['bytes'], 'pic.png', { type: 'image/png' });

    await act(async () => {
      await result.current.upload(file);
    });

    expect(h.upload).toHaveBeenCalledWith({ roomId: '!room:example', file });
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'pic.png',
        extra: expect.objectContaining({ msgtype: 'm.image', url: 'mxc://example/abc' }),
      }),
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    expect(h.pushLocal).toHaveBeenCalled();
    expect(result.current.isUploading).toBe(false);
  });

  it('uploads then sends m.file for non-image files', async () => {
    const h = makeHarness();
    const { result } = renderHook(() => useFileUpload(h.input));
    const file = new File(['bytes'], 'doc.pdf', { type: 'application/pdf' });

    await act(async () => {
      await result.current.upload(file);
    });

    const sendArgs = h.send.mock.calls[0][0];
    expect(sendArgs.extra.msgtype).toBe('m.file');
  });

  it('calls pushSystemNotice when upload fails', async () => {
    const h = makeHarness();
    h.upload.mockRejectedValueOnce(new Error('upload 502'));
    const { result } = renderHook(() => useFileUpload(h.input));

    await act(async () => {
      await result.current.upload(new File(['x'], 'foo.txt', { type: 'text/plain' }));
    });

    expect(h.patchLocal).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'error' }));
    expect(h.pushSystemNotice).toHaveBeenCalledTimes(1);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('flags an error when send.onError fires', () => {
    const h = makeHarness();
    const { result } = renderHook(() => useFileUpload(h.input));
    const sendCallbacks = vi.fn();
    h.send.mockImplementation((_args, cbs) => sendCallbacks(cbs));

    return act(async () => {
      await result.current.upload(new File(['x'], 'a.png', { type: 'image/png' }));
      const captured = sendCallbacks.mock.calls[0][0];
      captured.onError(new Error('rate limit'));
      expect(h.patchLocal).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'error' }));
      expect(h.pushSystemNotice).toHaveBeenCalled();
    });
  });

  it('does nothing when not logged in', async () => {
    const h = makeHarness();
    h.input.isLoggedIn = false;
    const { result } = renderHook(() => useFileUpload(h.input));

    await act(async () => {
      await result.current.upload(new File(['x'], 'a.png'));
    });

    expect(h.upload).not.toHaveBeenCalled();
  });
});