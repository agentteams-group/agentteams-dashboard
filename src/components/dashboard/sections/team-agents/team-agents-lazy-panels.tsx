'use client';

import dynamic from 'next/dynamic';

export function WorkbenchLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-32 flex-1 items-center justify-center text-xs text-muted-foreground" role="status">
      {label}
    </div>
  );
}

export const EntityInspector = dynamic(
  () => import('./entity-inspector').then((module) => ({ default: module.EntityInspector })),
  { ssr: false, loading: () => <WorkbenchLoading label="正在加载实体详情…" /> },
);
export const EntitySectionDialogs = dynamic(
  () => import('./entity-inspector-sections').then((module) => ({ default: module.EntitySectionDialogs })),
  { ssr: false, loading: () => <WorkbenchLoading label="正在加载详情面板…" /> },
);
export const TeamCreateDialog = dynamic(
  () => import('../teams/team-create-dialog').then((module) => ({ default: module.TeamCreateDialog })),
  { ssr: false, loading: () => <WorkbenchLoading label="正在加载创建团队…" /> },
);
export const WorkerCreateDialog = dynamic(
  () => import('../workers/worker-create-dialog').then((module) => ({ default: module.WorkerCreateDialog })),
  { ssr: false, loading: () => <WorkbenchLoading label="正在加载 Worker…" /> },
);
export const MillforgeDialog = dynamic(
  () => import('../teams/millforge/millforge-dialog').then((module) => ({ default: module.MillforgeDialog })),
  { ssr: false, loading: () => <WorkbenchLoading label="正在加载千锻…" /> },
);
