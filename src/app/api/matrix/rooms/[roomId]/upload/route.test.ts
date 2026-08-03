import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

describe('Matrix room media upload route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Build a multipart NextRequest, overriding formData to keep filenames. */
  function buildUploadRequest(filename: string, type: string, bytes: Uint8Array<ArrayBuffer>): NextRequest {
    const req = new NextRequest(
      'http://dashboard.test/api/matrix/rooms/room/upload?homeserver=http%3A%2F%2F127.0.0.1%3A6167',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'content-type': 'multipart/form-data; boundary=----TestBoundary',
        },
      },
    );
    req.formData = async () => {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type }), filename);
      return form;
    };
    return req;
  }

  it('forwards the raw file bytes with the file MIME type to the homeserver media API', async () => {
    const matrixFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ content_uri: 'mxc://example.com/abc123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const request = buildUploadRequest('note.txt', 'text/plain', new TextEncoder().encode('hello world'));

    const response = await POST(request, { params: Promise.resolve({ roomId: '!room:test' }) });

    expect(response.status).toBe(200);
    expect(matrixFetch).toHaveBeenCalledOnce();
    const [targetUrl, options] = matrixFetch.mock.calls[0] as [string, RequestInit];

    expect(targetUrl).toBe(
      'http://127.0.0.1:6167/_matrix/media/v3/upload?filename=note.txt'
    );
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('text/plain');
    expect(options.body).toBeInstanceOf(ArrayBuffer);
    expect(Buffer.from(options.body as ArrayBuffer).toString()).toBe('hello world');
  });

  it('defaults Content-Type to octet-stream when the file has no MIME type', async () => {
    const matrixFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ content_uri: 'mxc://example.com/xyz' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const request = buildUploadRequest('blob.bin', '', new TextEncoder().encode('data'));

    const response = await POST(request, { params: Promise.resolve({ roomId: '!room:test' }) });

    expect(response.status).toBe(200);
    const options = matrixFetch.mock.calls[0][1] as RequestInit;
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream');
  });
});
