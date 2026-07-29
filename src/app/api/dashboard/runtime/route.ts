import { NextResponse } from 'next/server';
import { getDashboardRuntimeInfo } from '@/lib/dashboard-runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getDashboardRuntimeInfo());
}
