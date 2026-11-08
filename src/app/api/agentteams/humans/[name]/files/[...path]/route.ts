import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';

export const dynamic = 'force-dynamic';

// 文件区代理（human files）：读（含 Range/If-Range/If-None-Match 条件读）、
// 写（PUT 直传 / POST presign+commit / DELETE 软删）。
//
// Controller 契约（agentteams-controller human_files_handler.go）：
//   GET    /humans/{h}/files[?recursive=1&limit&cursor] → JSON 列表
//   GET    /humans/{h}/files/{path}[?list=1]            → JSON 目录
//   GET    /humans/{h}/files/{path}[?presign=1]         → JSON 预签名票
//   GET    /humans/{h}/files/{path}                     → 字节（304/206/416）
//   HEAD   /humans/{h}/files/{path}                     → 元信息
//   PUT    /humans/{h}/files/{path}                     → 写（If-Match 乐观并发）
//   POST   /humans/{h}/files/{path}[?presign=1]         → 上传票
//   POST   /humans/{h}/files/{path}/commit              → 上传记账
//   DELETE /humans/{h}/files/{path}                     → 软删（返回 trashId）

const PASSTHROUGH = [
  'content-disposition',
  'content-length',
  'etag',
  'last-modified',
  'accept-ranges',
  'content-range',
];

const CONDITIONAL = ['range', 'if-range', 'if-none-match', 'if-match'];

function encodeRel(segments: string[] | undefined): string {
  return (segments ?? [])
    .filter((segment) => segment !== '')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function decodedRel(segments: string[] | undefined): string[] {
  return (segments ?? []).filter((segment) => segment !== '');
}

function jsonUpstream(name: string, rel: string, search: URLSearchParams): string {
  const qs = search.toString();
  return `/api/v1/humans/${encodeURIComponent(name)}/files${rel ? `/${rel}` : ''}${
    qs ? `?${qs}` : ''
  }`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; path: string[] }> },
) {
  const { name, path: segments } = await params;
  const rel = encodeRel(segments);
  const search = request.nextUrl.searchParams;

  const wantsJson =
    search.has('list') || search.get('presign') === '1' || search.get('recursive') === '1';

  if (wantsJson) {
    const forwarded = new URLSearchParams();
    for (const [key, value] of search.entries()) {
      if (key === 'controllerUrl') continue;
      forwarded.append(key, value);
    }
    // 递归平铺是文件区根端点；目录列表走路径端点 + ?list=1。
    const upstream =
      search.get('recursive') === '1' && rel === ''
        ? jsonUpstream(name, '', forwarded)
        : jsonUpstream(name, rel, forwarded);
    return proxyToAgentTeams(request, getControllerUrl(request), upstream, {
      forwardBody: false,
      stream: false,
    });
  }

  const forwarded = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === 'controllerUrl') continue;
    forwarded.append(key, value);
  }
  const upstream = jsonUpstream(name, rel, forwarded);
  return proxyToAgentTeams(request, getControllerUrl(request), upstream, {
    forwardBody: false,
    stream: true,
    passthroughHeaders: PASSTHROUGH,
    forwardRequestHeaders: CONDITIONAL,
    allowUpstream304: true,
  });
}

export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; path: string[] }> },
) {
  const { name, path: segments } = await params;
  const rel = encodeRel(segments);
  const upstream = jsonUpstream(name, rel, new URLSearchParams());
  return proxyToAgentTeams(request, getControllerUrl(request), upstream, {
    method: 'HEAD',
    forwardBody: false,
    passthroughHeaders: PASSTHROUGH,
    forwardRequestHeaders: CONDITIONAL,
    allowUpstream304: true,
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; path: string[] }> },
) {
  const { name, path: segments } = await params;
  const rel = encodeRel(segments);
  if (!rel) {
    return Response.json({ message: 'path is required' }, { status: 400 });
  }
  const upstream = jsonUpstream(name, rel, new URLSearchParams());
  return proxyToAgentTeams(request, getControllerUrl(request), upstream, {
    method: 'PUT',
    rawBody: true,
    forwardRequestHeaders: CONDITIONAL,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; path: string[] }> },
) {
  const { name, path: segments } = await params;
  const decoded = decodedRel(segments);
  const search = request.nextUrl.searchParams;

  // .../files/{path}/commit → 记账端点
  if (decoded.length > 0 && decoded[decoded.length - 1] === 'commit') {
    const rel = encodeRel(decoded.slice(0, -1));
    const upstream = `/api/v1/humans/${encodeURIComponent(name)}/files/${rel}/commit`;
    return proxyToAgentTeams(request, getControllerUrl(request), upstream, {
      method: 'POST',
      forwardBody: false,
    });
  }

  const rel = encodeRel(decoded);
  const forwarded = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key !== 'controllerUrl') forwarded.append(key, value);
  }
  const upstream = jsonUpstream(name, rel, forwarded);
  return proxyToAgentTeams(request, getControllerUrl(request), upstream, {
    method: 'POST',
    forwardBody: false,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; path: string[] }> },
) {
  const { name, path: segments } = await params;
  const rel = encodeRel(segments);
  if (!rel) {
    return Response.json({ message: 'path is required' }, { status: 400 });
  }
  const upstream = jsonUpstream(name, rel, new URLSearchParams());
  return proxyToAgentTeams(request, getControllerUrl(request), upstream, {
    method: 'DELETE',
    forwardBody: false,
  });
}
