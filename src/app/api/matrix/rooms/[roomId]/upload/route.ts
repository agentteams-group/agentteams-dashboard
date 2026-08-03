// POST /api/matrix/rooms/[roomId]/upload - Upload media to Matrix homeserver
import { NextRequest, NextResponse } from 'next/server';
import { getMatrixHomeserver, getAccessToken } from '../../../proxy-helper';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId: _roomId } = await params;
    const homeserver = getMatrixHomeserver(request);
    const accessToken = getAccessToken(request);

    // Get the file from FormData
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    // Matrix media upload expects the raw file bytes as the request body with
    // a Content-Type matching the file's MIME type — not a multipart wrapper.
    const filename = file.name;
    const targetUrl = `${homeserver}/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`;
    const fileBuffer = await file.arrayBuffer();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s for large files

    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: fileBuffer,
      });

      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
