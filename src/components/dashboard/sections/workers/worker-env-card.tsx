'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { WorkerEnvEditor } from './worker-env-editor';
import { WorkerGatewayProbe } from './worker-gateway-probe';
import { useUpdateWorker } from '@/hooks/use-agentteams-mutations';
import type { WorkerResponse } from '@/lib/agentteams-api';

/** 环境变量与网关：env 编辑保存（PUT 合并语义）+ 网关探测。 */
export function WorkerEnvCard({ worker, onSaved }: { worker: WorkerResponse; onSaved?: () => void }) {
  const updateWorker = useUpdateWorker();
  const initial = worker.envEditable ? worker.env ?? {} : {};
  const [env, setEnv] = useState<Record<string, string>>(initial);
  const [valid, setValid] = useState(true);
  const changed = JSON.stringify(env) !== JSON.stringify(initial);

  if (!worker.envEditable) {
    return (
      <div className="space-y-2 text-xs text-muted-foreground">
        <p>当前 Controller 或账号不支持编辑环境变量。</p>
        <WorkerGatewayProbe key={worker.name} workerName={worker.name} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <WorkerEnvEditor value={initial} onChange={setEnv} onValidityChange={setValid} />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={!changed || !valid || updateWorker.isPending}
          onClick={() => {
            updateWorker.mutate(
              { name: worker.name, data: { env } },
              { onSuccess: () => onSaved?.() },
            );
          }}
        >
          {updateWorker.isPending ? '保存中...' : '保存环境变量'}
        </Button>
        {changed && <span className="text-xs text-amber-600">有未保存的修改</span>}
      </div>
      <WorkerGatewayProbe key={worker.name} workerName={worker.name} />
    </div>
  );
}
