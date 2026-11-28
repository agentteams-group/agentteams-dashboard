import { NextResponse } from 'next/server';
import { listNacosAgentSpecs, type NacosAgentSpecSummary } from '@/lib/agentspec-fetcher';

export const dynamic = 'force-dynamic';

export type AgentSpecSummary = NacosAgentSpecSummary;

export async function GET() {
  const result = await listNacosAgentSpecs();
  return NextResponse.json(result);
}
