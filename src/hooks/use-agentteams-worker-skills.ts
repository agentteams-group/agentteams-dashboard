import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { agentteamsApi } from '@/lib/agentteams-api';
import { useWorkers } from './use-agentteams-workers';

export function useWorkerSkills(workerName: string | null) {
  const { data: workers = [] } = useWorkers();
  const runtimeByName = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const w of workers) map[w.name] = w.runtime;
    return map;
  }, [workers]);

  return useQuery({
    queryKey: ['agentteams-worker-skills', workerName, runtimeByName[workerName ?? ''] ?? 'unknown'],
    queryFn: () => {
      if (!workerName) return Promise.resolve([] as string[]);
      // Runtime is no longer part of the storage path (see
      // `runtimeSkillsSubpath` in `@/lib/skill-package`), so we keep the
      // signature for backwards compatibility but no longer differentiate
      // requests by it.
      const runtime = runtimeByName[workerName];
      const promise = runtime
        ? agentteamsApi.listWorkerSkills(workerName, runtime)
        : agentteamsApi.listWorkerSkills(workerName);
      return promise.then((r) => r.skills);
    },
    enabled: !!workerName,
    retry: 1,
    placeholderData: (previousData) => previousData,
    throwOnError: false,
  });
}

export interface UploadWorkerSkillResult {
  success: boolean;
  skillName: string;
  description: string;
  filesCount: number;
  prefix: string;
  note?: string;
  /** True when `spec.skills` was also updated to include the uploaded skill. */
  specUpdated: boolean;
  /** Populated when the file upload succeeded but `spec.skills` did not. */
  specError?: string;
  /**
   * Populated when both the file upload and `spec.skills` update succeeded
   * but the post-spec Worker reload did not confirm. The hook has already
   * attempted the reload exactly once; callers can surface this as a soft
   * failure since the on-disk prefix and the declarative spec are already
   * consistent and the next reconcile tick will pick the skill up.
   */
  reloadError?: string;
}

export interface UploadWorkerSkillOptions {
  /**
   * If true, the hook will trigger a Worker reload after `spec.skills` is
   * updated successfully. The reload is intentionally skipped when
   * `spec.skills` could not be updated so we never bounce a Worker into a
   * state where the on-disk prefix and the declarative spec diverge.
   * Defaults to true.
   */
  reloadAfterSpec?: boolean;
}

export function useUploadWorkerSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      workerName,
      file,
      options,
    }: {
      workerName: string;
      file: File;
      options?: UploadWorkerSkillOptions;
    }): Promise<UploadWorkerSkillResult> => {
      // 1) Push the package to the canonical Worker skill prefix WITHOUT
      //    restarting the worker. If this throws, spec.skills must not be
      //    touched. Restart happens in step 3 only after spec.skills is
      //    reconciled, so a partial distribution never leaves the Worker
      //    in a state where the on-disk prefix and the spec disagree.
      const upload = await agentteamsApi.uploadWorkerSkill(workerName, file, null, {
        restart: false,
      });

      // 2) Re-read the worker from the controller so we merge against the
      //    latest spec.skills instead of a stale page snapshot. This makes
      //    concurrent dashboard sessions safe.
      let specUpdated = false;
      let specError: string | undefined;
      try {
        const latest = await agentteamsApi.getWorker(workerName);
        const currentSkills = Array.isArray(latest.skills) ? latest.skills : [];
        if (!currentSkills.includes(upload.skillName)) {
          await agentteamsApi.updateWorker(workerName, {
            skills: [...currentSkills, upload.skillName],
          });
        }
        specUpdated = true;
      } catch (err) {
        specError = err instanceof Error ? err.message : 'spec.skills 更新失败';
      }

      // 3) Only when both the files and spec.skills are in place do we ask
      //    the controller to reload the worker. A failed reload is a soft
      //    failure — files and spec are already consistent and the next
      //    reconcile tick will pick the skill up.
      const shouldReload = options?.reloadAfterSpec !== false;
      let reloadOk = true;
      let reloadError: string | undefined;
      if (specUpdated && shouldReload) {
        try {
          const reload = await agentteamsApi.restartWorker(workerName);
          reloadOk = reload?.success !== false;
          if (!reloadOk) reloadError = reload?.note ?? 'Worker 重启未确认';
        } catch (err) {
          reloadOk = false;
          reloadError = err instanceof Error ? err.message : 'Worker 重启失败';
        }
      }

      return {
        ...upload,
        specUpdated,
        specError,
        ...(specUpdated && shouldReload && !reloadOk
          ? { reloadError }
          : {}),
      };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['agentteams-worker-skills', variables.workerName],
      });
      queryClient.invalidateQueries({ queryKey: ['agentteams-workers'] });
    },
  });
}
