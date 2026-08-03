import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';

const MCP_SERVERS_PREFIX = 'mcp-servers/';

interface McpServerConfig {
  name: string;
  url: string;
  transport: string;
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

  let body: { url?: string; transport?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const key = `${MCP_SERVERS_PREFIX}${name}.json`;

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
}

export async function DELETE(
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
    await client.removeObject(bucket, key);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('NoSuchKey')) {
      return NextResponse.json({ error: 'MCP 服务器不存在' }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
