import { NextRequest, NextResponse } from 'next/server';
import { getAuthToken, getControllerUrl } from '../../proxy-helper';
import type { LogLine } from '@/lib/hiclaw-api';

const DEFAULT_TAIL = 500;
const MAX_TAIL = 10000;

function resolveContainerName(component: string): string {
  switch (component) {
    case 'controller':
      return 'hiclaw-controller';
    case 'manager':
      return 'hiclaw-manager';
    case 'matrix':
    case 'minio':
    case 'higress':
      // In embedded mode these all run inside the controller container.
      return 'hiclaw-controller';
    default:
      return component;
  }
}

function parseDockerLogs(buffer: ArrayBuffer, component: string): LogLine[] {
  const view = new DataView(buffer);
  const decoder = new TextDecoder('utf-8');
  const lines: LogLine[] = [];
  let offset = 0;

  while (offset + 8 <= view.byteLength) {
    const streamType = view.getUint8(offset);
    // bytes 1-3 are padding
    const length = view.getUint32(offset + 4, false); // big-endian
    if (length < 0 || offset + 8 + length > view.byteLength) break;

    const payload = decoder.decode(new Uint8Array(buffer, offset + 8, length));
    const level = streamType === 2 ? 'error' : 'info';

    // Docker timestamps are RFC3339Nano, e.g. 2026-07-04T11:18:30.123456789Z
    const tsRegex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s(.*)$/;

    payload.split('\n').forEach((raw) => {
      if (!raw) return;
      const match = raw.match(tsRegex);
      if (match) {
        lines.push({
          timestamp: match[1],
          level,
          component,
          message: match[2].trimEnd(),
        });
      } else {
        lines.push({
          timestamp: new Date().toISOString(),
          level,
          component,
          message: raw.trimEnd(),
        });
      }
    });

    offset += 8 + length;
  }

  return lines;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ component: string }> }
) {
  const { component } = await params;
  const container = resolveContainerName(decodeURIComponent(component));
  const tailParam = request.nextUrl.searchParams.get('tail');
  const tail = Math.min(
    Math.max(parseInt(tailParam || String(DEFAULT_TAIL), 10), 1),
    MAX_TAIL
  );

  try {
    const controllerUrl = getControllerUrl(request);
    const token = await getAuthToken();
    const target = new URL(
      `/docker/v1.41/containers/${encodeURIComponent(container)}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`,
      controllerUrl
    ).toString();

    const res = await fetch(target, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Docker API returned ${res.status}: ${text}` },
        { status: res.status }
      );
    }

    const buffer = await res.arrayBuffer();
    const lines = parseDockerLogs(buffer, component);
    return NextResponse.json(lines);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown log error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
