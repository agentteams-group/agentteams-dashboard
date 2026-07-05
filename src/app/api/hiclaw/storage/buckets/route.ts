import { NextRequest, NextResponse } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';

export async function GET() {
  try {
    const client = createMinioClient();
    const configured = getMinioBucket();

    let buckets: Array<{ name: string; creationDate?: Date }>;
    try {
      buckets = await client.listBuckets();
    } catch {
      // Fallback to the configured bucket if ListBuckets is denied.
      buckets = configured ? [{ name: configured }] : [];
    }

    return NextResponse.json({ buckets });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown storage error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// POST — Create a new bucket
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const bucketName = body.name || body.bucket;
    if (!bucketName || typeof bucketName !== 'string') {
      return NextResponse.json({ error: 'Bucket name is required' }, { status: 400 });
    }

    const client = createMinioClient();
    const exists = await client.bucketExists(bucketName);
    if (exists) {
      return NextResponse.json({ error: `Bucket "${bucketName}" already exists` }, { status: 409 });
    }

    await client.makeBucket(bucketName);
    return NextResponse.json({ success: true, name: bucketName }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create bucket';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
