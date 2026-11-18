import type { ReactNode } from 'react';
import Image from 'next/image';
import { Card } from '@/components/ui/card';
import styles from './sign-in-layout.module.css';

export function SignInLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${styles.surface} flex min-h-dvh flex-col px-5 sm:px-10 lg:px-14`}>
      <header className="mx-auto flex w-full max-w-7xl items-center gap-3 border-b border-white/10 py-5 sm:py-6">
        <Image src="/agentteams-logo.svg" alt="" width={32} height={32} />
        <span className="text-lg font-semibold tracking-tight">AgentTeams</span>
      </header>
      <div className="mx-auto grid w-full max-w-7xl flex-1 items-center gap-10 py-8 lg:grid-cols-[1.1fr_1fr] lg:py-14">
        <section className="hidden max-w-2xl lg:block">
          <h1 className="text-4xl leading-snug font-semibold tracking-tight xl:text-5xl">
            让 Agent 成为团队，<br /><span className="text-[#71e4ae]">一起把事情做成。</span>
          </h1>
          <p className="mt-6 max-w-md text-sm leading-7 text-[#c1d2d4]">把目标交给 Manager，让 Workers 分工推进。从第一句需求到最终成果，在同一个工作台里协作。</p>
        </section>
        <Card className="w-full max-w-md justify-self-center rounded-2xl bg-card text-card-foreground shadow-xl sm:px-2">
          {children}
        </Card>
      </div>
    </div>
  );
}
