// GET /api/matrix/search - 房间内容全文检索（方案 v3 B-1）
//
// 走服务端代理而不是让浏览器直连 homeserver，和其余 matrix 路由同一条约定：
// homeserver 允许列表校验（SEC-05）和审计留在服务端，Bearer token 只从
// Authorization 头取，绝不接受 query 传 token。
// filter JSON 在这里拼装，客户端只传 search_term / room_id / limit 三个白名单参数，
// 避免运维界面被人塞任意 filter 打到上游。room_id 缺省即不限制房间。
import { NextRequest, NextResponse } from 'next/server';
import { getMatrixHomeserver, getAccessToken, proxyToMatrix } from '../proxy-helper';
import { buildRoomSearchFilter, buildSearchProxyPath } from '@/lib/matrix-search';

const MAX_TERM_LENGTH = 256;

export async function GET(request: NextRequest) {
  try {
    const homeserver = getMatrixHomeserver(request);
    const accessToken = getAccessToken(request);

    const roomId = request.nextUrl.searchParams.get('room_id') || null;
    const term = (request.nextUrl.searchParams.get('search_term') || '').slice(0, MAX_TERM_LENGTH);
    const nextBatch = request.nextUrl.searchParams.get('next_batch') || undefined;
    const limitParam = Number(request.nextUrl.searchParams.get('limit') || '50');
    const limit = Number.isFinite(limitParam) ? limitParam : 50;

    // search_term 必需；room_id 可选——缺它就是跨房间检索（命令面板的 message 实体）。
    if (!term.trim()) {
      return NextResponse.json(
        { errcode: 'M_MISSING_PARAM', error: 'search_term is required' },
        { status: 400 },
      );
    }

    const path = buildSearchProxyPath(buildRoomSearchFilter(roomId, term, limit), nextBatch);
    return await proxyToMatrix(request, homeserver, path, accessToken, {
      method: 'GET',
      forwardBody: false,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
