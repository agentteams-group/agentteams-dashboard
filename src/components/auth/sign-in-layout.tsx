import type { ReactNode } from 'react';
import Image from 'next/image';
import { Card } from '@/components/ui/card';
import styles from './sign-in-layout.module.css';

export function SignInLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${styles.surface} flex min-h-dvh flex-col px-5 sm:px-10 lg:px-14`}>
      <header className="mx-auto flex w-full max-w-7xl items-center gap-3 border-b border-white/10 py-5 sm:py-6">
        <Image src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/agentteams-logo.svg`} alt="" width={32} height={32} />
        <span className="text-lg font-semibold tracking-tight">AgentTeams</span>
      </header>
      <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 py-8 lg:grid-cols-[minmax(0,35rem)_minmax(0,28rem)] lg:justify-center lg:py-14 xl:gap-16">
        <section className="hidden lg:block">
          <h1 className="text-5xl leading-tight font-semibold tracking-tight xl:text-6xl">
            <span className="block whitespace-nowrap">人与 Agent 团队，</span><span className="block whitespace-nowrap text-[#71e4ae]">协作进化。</span>
          </h1>
          <p className="mt-6 text-xl leading-8 text-[#d4e2e4] xl:text-2xl xl:leading-9">
            <span className="block">管理资产，组织团队，交付任务</span>
            <span className="block">AI跟进构建-协作-治理每一步</span>
          </p>
        </section>
        <Card className="w-full max-w-md justify-self-center rounded-2xl bg-card text-card-foreground shadow-xl sm:px-2">
          {children}
        </Card>
      </div>
    </div>
  );
}
