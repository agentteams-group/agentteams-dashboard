import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { readServerIdentity } from '@/lib/server-auth';
import { AVATAR_IMAGE_TYPES, AVATAR_PRESETS, MAX_AVATAR_BYTES, type AvatarKind } from '@/lib/avatars';
import { readAvatar, readAvatarPreset, writeAvatar } from '@/lib/avatar-storage';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

type Params = { params: Promise<{ kind: string; name: string }> };

function validTarget(kind: string, name: string): kind is AvatarKind {
  return (kind === 'human' || kind === 'agent') && name.length > 0 && name.length <= 255;
}

export async function GET(request: NextRequest, { params }: Params) {
  if (!readServerIdentity(request)) return new NextResponse(null, { status: 401 });
  const { kind, name } = await params;
  if (!validTarget(kind, name)) return new NextResponse(null, { status: 404 });
  const image = await readAvatar(kind, name);
  return new NextResponse(new Uint8Array(image), {
    headers: {
      'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=60',
      'Vary': 'Cookie, Authorization', 'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const identity = readServerIdentity(request);
  if (!identity) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const { kind, name } = await params;
  if (!validTarget(kind, name)) return new NextResponse(null, { status: 404 });
  if (kind === 'human' ? identity.name !== name : identity.level < 3) {
    return NextResponse.json({ error: '没有权限修改此头像' }, { status: 403 });
  }
  if (kind === 'agent') {
    const response = await proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/workers/${encodeURIComponent(name)}`, { method: 'GET', forwardBody: false });
    if (!response.ok) return response;
  }

  const contentType = request.headers.get('content-type') || '';
  const isPreset = contentType === 'application/json';
  const limit = isPreset ? 256 : MAX_AVATAR_BYTES;
  const reader = request.body?.getReader();
  if (!reader || (!isPreset && !AVATAR_IMAGE_TYPES.includes(contentType))) {
    return NextResponse.json({ error: '请选择预设头像，或上传 PNG、JPEG、WebP 图片' }, { status: 400 });
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      return NextResponse.json({ error: '图片不能超过 2 MB' }, { status: 413 });
    }
    chunks.push(value);
  }

  const data = Buffer.concat(chunks);
  let image: Buffer;
  try {
    if (isPreset) {
      const { preset } = JSON.parse(data.toString('utf8'));
      if (!AVATAR_PRESETS.some(entry => entry.id === preset)) throw new Error('Invalid preset');
      image = await readAvatarPreset(preset);
    } else {
      const source = sharp(data, { limitInputPixels: 16_000_000 });
      const { format } = await source.metadata();
      if (!format || !AVATAR_IMAGE_TYPES.includes(`image/${format}`)) throw new Error('Invalid image');
      image = await source.rotate().resize(192, 192, { fit: 'cover' }).png().toBuffer();
    }
  } catch {
    return NextResponse.json({ error: '无法读取所选头像，请换一张图片' }, { status: 400 });
  }
  await writeAvatar(kind, name, image);
  return new NextResponse(null, { status: 204 });
}
