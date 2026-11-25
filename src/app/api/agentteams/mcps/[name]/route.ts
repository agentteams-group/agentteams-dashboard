import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';
import { publicMcpRecord, readMcpRecord, withMcpRecordLock, type ManagedMcpRecord } from '@/lib/server/mcp-management';
import { requireHigressConsoleAccess } from '@/app/api/higress/access';

const MCP_SERVERS_PREFIX = 'mcp-servers/';

interface McpServerConfig {
  name: string;
  url: string;
  transport: string;
  type?: string;
  timeout?: number;
  headers?: Record<string, string>;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

function isValidMcpName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  const { name } = await params;
  if (!isValidMcpName(name)) {
    return NextResponse.json({ error: 'Invalid MCP server name' }, { status: 400 });
  }

  const key = `${MCP_SERVERS_PREFIX}${name}.json`;

  try {
    const client = createMinioClient();
    const stream = await client.getObject(bucket, key);
    const data = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
    const config = JSON.parse(data.toString('utf-8')) as McpServerConfig;
    if ((config as unknown as ManagedMcpRecord).managed) {
      const denied = await requireHigressConsoleAccess(_request);
      if (denied) return denied;
      return NextResponse.json(publicMcpRecord(config as unknown as ManagedMcpRecord));
    }
    return NextResponse.json(config);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('NoSuchKey')) {
      return NextResponse.json({ error: 'MCP 服务器不存在' }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  const { name } = await params;
  if (!isValidMcpName(name)) {
    return NextResponse.json({ error: 'Invalid MCP server name' }, { status: 400 });
  }

  const denied = await enforceLevelOnlyRbac(request, 'update', 'mcp', name);
  if (denied) return denied;

  let body: { url?: string; transport?: string; type?: string; timeout?: number; headers?: Record<string, string>; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const key = `${MCP_SERVERS_PREFIX}${name}.json`;

  return withMcpRecordLock(name, async () => {
    let existing: McpServerConfig;
    try {
      const client = createMinioClient();
      const stream = await client.getObject(bucket, key);
      const data = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });
      existing = JSON.parse(data.toString('utf-8')) as McpServerConfig;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('NoSuchKey')) {
        return NextResponse.json({ error: 'MCP 服务器不存在' }, { status: 404 });
      }
      return NextResponse.json({ error: '读取失败' }, { status: 502 });
    }

    if ((existing as unknown as ManagedMcpRecord).managed) return NextResponse.json({ error: '请通过 MCP 接入流程更新受管服务。' }, { status: 409 });

    const url = body.url ?? existing.url;
    const transport = body.transport ?? existing.transport;
    const description = body.description !== undefined ? body.description : existing.description;

    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return NextResponse.json({ error: 'URL 须为有效的 HTTP(S) 地址' }, { status: 400 });
    }
    if (!transport || !['sse', 'streaminghttp'].includes(transport)) {
      return NextResponse.json({ error: 'transport 须为 "sse" 或 "streaminghttp"' }, { status: 400 });
    }

    const config: McpServerConfig = {
      ...existing,
      url,
      transport,
      type: body.type !== undefined ? body.type : existing.type,
      timeout: body.timeout !== undefined ? body.timeout : existing.timeout,
      headers: body.headers !== undefined ? body.headers : existing.headers,
      description,
      updatedAt: new Date().toISOString(),
    };

    try {
      const client = createMinioClient();
      const data = Buffer.from(JSON.stringify(config, null, 2));
      await client.putObject(bucket, key, data, data.length, {
        'Content-Type': 'application/json',
      });
      return NextResponse.json({ success: true, ...config });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown storage error';
      return NextResponse.json({ error: message }, { status: 502 });
    }
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  const { name } = await params;
  if (!isValidMcpName(name)) {
    return NextResponse.json({ error: 'Invalid MCP server name' }, { status: 400 });
  }

  const denied = await enforceLevelOnlyRbac(request, 'delete', 'mcp', name);
  if (denied) return denied;

  return withMcpRecordLock(name, async () => {
    if ((await readMcpRecord(name))?.managed) return NextResponse.json({ error: '请通过 MCP 服务详情删除受管服务。' }, { status: 409 });

    const key = `${MCP_SERVERS_PREFIX}${name}.json`;

    try {
      const client = createMinioClient();
      await client.removeObject(bucket, key);
      return NextResponse.json({ success: true });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('NoSuchKey')) {
        return NextResponse.json({ error: 'MCP 服务器不存在' }, { status: 404 });
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ error: message }, { status: 502 });
    }
  });
}
