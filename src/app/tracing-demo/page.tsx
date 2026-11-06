import { notFound } from 'next/navigation';
import { QueryProvider } from '@/lib/query-provider';
import { TracingSection } from '@/components/dashboard/sections/tracing-section';

export const dynamic = 'force-dynamic';

export default function TracingDemoPage() {
  if (process.env.AGENTTEAMS_TRACING_DEMO !== 'true') notFound();
  return <QueryProvider><main className="mx-auto max-w-[1600px] p-5 md:p-8">
    <div className="mb-7 flex items-center justify-between border-b pb-5">
      <div><p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">AgentTeams / Observability</p><h1 className="mt-1 text-xl font-semibold">多运行时 Worker 链路追踪</h1></div>
      <p className="max-w-60 text-right text-xs text-muted-foreground">本机隔离演示<br />fixture 标签表示使用测试模型响应</p>
    </div>
    <TracingSection />
  </main></QueryProvider>;
}
