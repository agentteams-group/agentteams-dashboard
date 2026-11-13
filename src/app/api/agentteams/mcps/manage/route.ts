import { NextRequest, NextResponse } from 'next/server';
import { requireHigressConsoleAccess } from '@/app/api/higress/access';
import { isRecord } from '@/app/api/higress/helpers';
import { authorizeManagedMcp, deleteManagedMcp, importMcpOpenApi, McpManagementError, mcpCapabilities, saveManagedMcp, verifyManagedMcp } from '@/lib/server/mcp-management';
import type { McpManagedInput } from '@/lib/mcp-management';

export async function GET(request: NextRequest) {
  const denied = await requireHigressConsoleAccess(request);
  if (denied) return denied;
  try { return NextResponse.json(await mcpCapabilities(request)); }
  catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  const denied = await requireHigressConsoleAccess(request);
  if (denied) return denied;
  try {
    const body: unknown = await request.json().catch(() => null);
    if (!isRecord(body)) throw new McpManagementError('请求格式不正确。');
    if (body.action === 'save') return NextResponse.json(await saveManagedMcp(request, body.input as McpManagedInput));
    if (body.action === 'import') return NextResponse.json(await importMcpOpenApi(request, body.content as string));
    if (typeof body.name !== 'string') throw new McpManagementError('请选择 MCP 服务。');
    if (body.action === 'verify') return NextResponse.json(await verifyManagedMcp(body.name));
    if (body.action === 'call') {
      if (typeof body.tool !== 'string' || !isRecord(body.arguments)) throw new McpManagementError('工具调用参数不正确。');
      return NextResponse.json(await verifyManagedMcp(body.name, body.tool, body.arguments));
    }
    if (body.action === 'authorize') return NextResponse.json(await authorizeManagedMcp(request, body.name, body.workers as string[]));
    if (body.action === 'delete') return NextResponse.json(await deleteManagedMcp(request, body.name));
    throw new McpManagementError('不支持的 MCP 操作。');
  } catch (error) { return failure(error); }
}

function failure(error: unknown) {
  // Gateway responses can echo configured credentials. Only our bounded,
  // operator-facing errors cross the BFF boundary.
  return NextResponse.json({ error: error instanceof McpManagementError ? error.message : 'MCP 操作失败，请检查服务连接与网关配置后重试。' }, { status: error instanceof McpManagementError ? error.status : 502 });
}
