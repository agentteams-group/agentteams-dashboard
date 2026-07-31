import { NextRequest, NextResponse } from 'next/server';
import type { MetricResponse, MetricPoint } from '@/lib/agentteams-api';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const { searchParams } = request.nextUrl;
  const entity = (searchParams.get('entity') || 'worker') as 'worker' | 'team';
  const hours = parseInt(searchParams.get('hours') || '1', 10);
  const intervalMinutes = parseInt(searchParams.get('interval') || '1', 10);

  // Generate simulated metric data for development when controller doesn't expose /metrics
  const data: MetricPoint[] = generateMockMetrics(name, entity, hours, intervalMinutes);

  const response: MetricResponse = {
    entity,
    name,
    data,
  };

  return NextResponse.json(response, {
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
  });
}

/**
 * Generate realistic synthetic metrics for a worker or team entity.
 * In production, this would be replaced by real Prometheus scrape data.
 */
function generateMockMetrics(
  name: string,
  entity: 'worker' | 'team',
  hours: number,
  intervalMinutes: number,
): MetricPoint[] {
  const points: MetricPoint[] = [];
  const totalMinutes = hours * 60;
  const now = Date.now();

  // Use entity name hash to produce deterministic but varied numbers
  let seed = 0;
  for (const c of name) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;

  const random = (min: number, max: number) => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return min + (seed % 1000) / 1000 * (max - min);
  };

  for (let mins = totalMinutes; mins >= 0; mins -= intervalMinutes) {
    const timestamp = new Date(now - mins * 60 * 1000).toISOString();
    const timeOfDayFactor = Math.sin((totalMinutes - mins) / totalMinutes * Math.PI); // 0→1→0 curve

    const cpu = Math.min(100, Math.max(0,
      (30 + timeOfDayFactor * 40 + random(-10, 10)) * (entity === 'worker' ? 1 : 0.6)
    ));
    const memory = Math.round(
      (2e9 + timeOfDayFactor * 1.5e9 + random(-200_000_000, 200_000_000))
    );
    const networkRx = Math.round(random(500_000, 5_000_000));
    const networkTx = Math.round(random(200_000, 3_000_000));

    points.push({ timestamp, cpu: Math.round(cpu * 100) / 100, memory, networkRx, networkTx });
  }

  return points;
}
