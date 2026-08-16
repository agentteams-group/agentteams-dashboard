// GET /api/matrix/media/[...path] — proxy homeserver media to the browser.
//
// Browsers usually cannot reach the homeserver directly (internal DNS,
// self-signed TLS), so mxc:// URIs resolve to this route instead.
// `?homeserver=` selects the upstream, validated against the same allowlist
// as every other Matrix proxy route; all other query params (`download`,
// thumbnail `width`/`height`/`method`) are forwarded verbatim.
//
// The access token is optional: <img>/<video> tags cannot send Authorization
// headers, so media relies on the homeserver's unauthenticated media repo
// (Matrix's capability-URL model — media IDs are unguessable). When a token
// IS present (e.g. fetch-based preview) it is forwarded upstream.
import { NextRequest, NextResponse } from 'next/server';
import {
  HomeserverValidationError,
  validateHomeserverUrl,
} from '@/lib/homeserver-allowlist';

const TIMEOUT_MS = 30000;

const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'content-disposition',
  'cache-control',
  'etag',
  'last-modified',
] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;

  const homeserver = request.nextUrl.searchParams.get('homeserver');
  if (!homeserver) {
    return NextResponse.json(
      { error: 'Missing homeserver URL. Provide via ?homeserver= parameter.' },
      { status: 400 }
    );
  }
  try {
    validateHomeserverUrl(homeserver);
  } catch (err) {
    if (err instanceof HomeserverValidationError) {
      return NextResponse.json(
        { error: err.message, reason: err.reason },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: 'Invalid homeserver URL' }, { status: 400 });
  }

  if (!path.length || path.some((seg) => !seg || seg === '.' || seg === '..')) {
    return NextResponse.json({ error: 'Invalid media path' }, { status: 400 });
  }

  const mediaPath = path.map((seg) => encodeURIComponent(seg)).join('/');
  const query = new URLSearchParams();
  request.nextUrl.searchParams.forEach((value, key) => {
    if (key !== 'homeserver') query.set(key, value);
  });
  const qs = query.toString();
  const targetUrl = `${homeserver}/_matrix/media/${mediaPath}${qs ? `?${qs}` : ''}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    const auth = request.headers.get('Authorization');
    if (auth) headers.Authorization = auth;

    const res = await fetch(targetUrl, { headers, signal: controller.signal });

    const responseHeaders = new Headers();
    for (const header of PASSTHROUGH_HEADERS) {
      const value = res.headers.get(header);
      if (value) responseHeaders.set(header, value);
    }

    const data = await res.arrayBuffer();
    return new NextResponse(data, { status: res.status, headers: responseHeaders });
  } catch {
    return NextResponse.json({ error: 'Matrix media request failed' }, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }
}
