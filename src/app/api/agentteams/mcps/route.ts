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

async function listAllObjects(client: any, bucket: string, prefix: string): Promise<any[]> {
  const objects: any[] = [];
  const stream = client.listObjects(bucket, prefix, true);
  for await (const obj of stream) {
    objects.push(obj);
  }
  return objects;
}

export async function GET() {
  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  try {
    const client = createMinioClient();
    const objects = await listAllObjects(client, bucket, MCP_SERVERS_PREFIX);
    const servers: McpServerConfig[] = [];

    for (const obj of objects) {
      const key = obj.objectName;
      if (!key.endsWith('.json')) continue;
      const name = key.slice(MCP_SERVERS_PREFIX.length, -5);
      if (!isValidMcpName(name)) continue;

      try {
        const stream = await client.getObject(bucket, key);
        const data = await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });
        const config = JSON.parse(data.toString('utf-8')) as McpServerConfig;
        if (config.name && config.url && config.transport) {
          servers.push(config);
        }
      } catch {
        // skip corrupted entries
      }
    }

    return NextResponse.json({ servers: servers.sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const bucket = getMinioBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'MinIO 未配置' }, { status: 503 });
  }

  let body: { name?: string; url?: string; transport?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const { name, url, transport, description } = body;

  if (!name || !isValidMcpName(name)) {
    return NextResponse.json({ error: 'MCP 服务器名称不合法（仅允许字母、数字、点、下划线、连字符）' }, { status: 400 });
  }
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return NextResponse.json({ error: 'MCP 服务器 URL 须为有效的 HTTP(S) 地址' }, { status: 400 });
  }
  if (!transport || !['sse', 'streaminghttp'].includes(transport)) {
    return NextResponse.json({ error: 'transport 须为 "sse" 或 "streaminghttp"' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const config: McpServerConfig = {
    name,
    url,
    transport,
    description: description || undefined,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const client = createMinioClient();
    const key = `${MCP_SERVERS_PREFIX}${name}.json`;
    const data = Buffer.from(JSON.stringify(config, null, 2));
    await client.putObject(bucket, key, data, data.length, {
      'Content-Type': 'application/json',
    });
    return NextResponse.json({ success: true, ...config }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
