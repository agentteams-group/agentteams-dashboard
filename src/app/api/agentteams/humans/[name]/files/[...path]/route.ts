import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/humans/{name}/files/{path...}
//
// Three controller shapes behind one URL (human_files_handler.go getFile):
//   ?list=1     → JSON directory listing (listDirectory)
//   ?presign=1  → JSON presigned download URL (#1475 PR-4); a deployment
//                 without a caller-reachable storage origin answers 501,
//                 which the UI treats as "fall back to the streamed GET"
//   default     → the file's bytes, streamed so a large file never has to be
//                 buffered by the dashboard before the browser can save it
//
// Non-2xx statuses pass through unchanged: the controller answers 404 for
// both "no such path" and "not visible to this caller" (deliberately
// indistinguishable) and 403 only for explicit denials, which the UI maps to
// the two distinct messages.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; path: string[] }> },
) {
  const { name, path: segments } = await params;
  // Re-encode each segment: the wildcard arrives decoded, and the controller
  // expects one percent-encoded path with '/' separators intact.
  const rel = (segments ?? [])
    .filter((segment) => segment !== '')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  const search = request.nextUrl.searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of search.entries()) {
    if (key === 'controllerUrl') continue; // internal override, not proxied
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  const upstream = `/api/v1/humans/${encodeURIComponent(name)}/files${rel ? `/${rel}` : ''}${
    qs ? `?${qs}` : ''
  }`;

  const wantsJson = search.has('list') || search.get('presign') === '1';

  return proxyToAgentTeams(request, getControllerUrl(request), upstream, {
    forwardBody: false,
    stream: !wantsJson,
    passthroughHeaders: ['content-disposition', 'content-length', 'etag', 'last-modified'],
  });
}
