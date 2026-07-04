import { NextResponse } from 'next/server';
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
