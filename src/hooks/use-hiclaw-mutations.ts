import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hiclawApi } from '@/lib/hiclaw-api';
import type {
  CreateWorkerRequest,
  UpdateWorkerRequest,
  CreateTeamRequest,
  UpdateTeamRequest,
  CreateHumanRequest,
  UpdateHumanRequest,
  CreateManagerRequest,
  UpdateManagerRequest,
  CreateConsumerRequest,
  WorkerResponse,
  WorkerPhase,
} from '@/lib/hiclaw-api';
import { toast } from 'sonner';
import { useNotificationStore } from '@/lib/notification-store';
import { formatErrorMessage } from '@/lib/api-error';

function useNotify() {
  const addNotification = useNotificationStore((s) => s.addNotification);
  return addNotification;
}

// Worker Mutations
export function useCreateWorker() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (data: CreateWorkerRequest) => hiclawApi.createWorker(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-workers'] });
      queryClient.invalidateQueries({ queryKey: ['hiclaw-cluster-status'] });
      toast.success(`Worker "${variables.name}" 创建成功`);
      addNotification({ type: 'success', title: 'Worker 创建成功', message: `Worker "${variables.name}" 已创建` });
    },
    onError: (err, variables) => {
      toast.error(`Worker "${variables.name}" 创建失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Worker 创建失败', message: formatErrorMessage(err) });
    },
  });
}

export function useDeleteWorker() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (name: string) => hiclawApi.deleteWorker(name),
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey: ['hiclaw-workers'] });
      const previous = queryClient.getQueryData<WorkerResponse[]>(['hiclaw-workers']);
      queryClient.setQueryData<WorkerResponse[]>(['hiclaw-workers'], (old) =>
        old?.filter((w) => w.name !== name)
      );
      return { previous };
    },
    onError: (err, name, context) => {
      if (context?.previous) queryClient.setQueryData(['hiclaw-workers'], context.previous);
      toast.error(`Worker "${name}" 删除失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Worker 删除失败', message: formatErrorMessage(err) });
    },
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-cluster-status'] });
      toast.success(`Worker "${name}" 已删除`);
      addNotification({ type: 'success', title: 'Worker 已删除', message: `Worker "${name}" 已删除` });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['hiclaw-workers'] }),
  });
}

export function useUpdateWorker() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: UpdateWorkerRequest }) =>
      hiclawApi.updateWorker(name, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-workers'] });
      queryClient.invalidateQueries({ queryKey: ['hiclaw-worker-detail', variables.name] });
      toast.success(`Worker "${variables.name}" 更新成功`);
      addNotification({ type: 'success', title: 'Worker 更新成功', message: `Worker "${variables.name}" 已更新` });
    },
    onError: (err, variables) => {
      toast.error(`Worker "${variables.name}" 更新失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Worker 更新失败', message: formatErrorMessage(err) });
    },
  });
}

export function useWakeWorker() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (name: string) => hiclawApi.wakeWorker(name),
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey: ['hiclaw-workers'] });
      const previous = queryClient.getQueryData<WorkerResponse[]>(['hiclaw-workers']);
      queryClient.setQueryData<WorkerResponse[]>(['hiclaw-workers'], (old) =>
        old?.map((w) => w.name === name ? { ...w, phase: 'Pending' as WorkerPhase } : w)
      );
      return { previous };
    },
    onError: (err, name, context) => {
      if (context?.previous) queryClient.setQueryData(['hiclaw-workers'], context.previous);
      toast.error(`Worker "${name}" 唤醒失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Worker 唤醒失败', message: formatErrorMessage(err) });
    },
    onSuccess: (_, name) => {
      toast.success(`Worker "${name}" 已唤醒`);
      addNotification({ type: 'success', title: 'Worker 已唤醒', message: `Worker "${name}" 已唤醒` });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['hiclaw-workers'] }),
  });
}

export function useSleepWorker() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (name: string) => hiclawApi.sleepWorker(name),
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey: ['hiclaw-workers'] });
      const previous = queryClient.getQueryData<WorkerResponse[]>(['hiclaw-workers']);
      queryClient.setQueryData<WorkerResponse[]>(['hiclaw-workers'], (old) =>
        old?.map((w) => w.name === name ? { ...w, phase: 'Pending' as WorkerPhase } : w)
      );
      return { previous };
    },
    onError: (err, name, context) => {
      if (context?.previous) queryClient.setQueryData(['hiclaw-workers'], context.previous);
      toast.error(`Worker "${name}" 休眠失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Worker 休眠失败', message: formatErrorMessage(err) });
    },
    onSuccess: (_, name) => {
      toast.success(`Worker "${name}" 已休眠`);
      addNotification({ type: 'success', title: 'Worker 已休眠', message: `Worker "${name}" 已休眠` });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['hiclaw-workers'] }),
  });
}

export function useEnsureReadyWorker() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (name: string) => hiclawApi.ensureReadyWorker(name),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-workers'] });
      toast.success(`Worker "${name}" 已请求就绪`);
      addNotification({ type: 'success', title: 'Worker 就绪请求已发送', message: `Worker "${name}" 已请求就绪` });
    },
    onError: (err, name) => {
      toast.error(`Worker "${name}" 就绪请求失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Worker 就绪请求失败', message: formatErrorMessage(err) });
    },
  });
}

// Team Mutations
export function useCreateTeam() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (data: CreateTeamRequest) => hiclawApi.createTeam(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-teams'] });
      queryClient.invalidateQueries({ queryKey: ['hiclaw-cluster-status'] });
      toast.success(`团队 "${variables.name}" 创建成功`);
      addNotification({ type: 'success', title: '团队创建成功', message: `团队 "${variables.name}" 已创建` });
    },
    onError: (err, variables) => {
      toast.error(`团队 "${variables.name}" 创建失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: '团队创建失败', message: formatErrorMessage(err) });
    },
  });
}

export function useDeleteTeam() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (name: string) => hiclawApi.deleteTeam(name),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-teams'] });
      queryClient.invalidateQueries({ queryKey: ['hiclaw-cluster-status'] });
      toast.success(`团队 "${name}" 已删除`);
      addNotification({ type: 'success', title: '团队已删除', message: `团队 "${name}" 已删除` });
    },
    onError: (err, name) => {
      toast.error(`团队 "${name}" 删除失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: '团队删除失败', message: formatErrorMessage(err) });
    },
  });
}

export function useUpdateTeam() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: UpdateTeamRequest }) =>
      hiclawApi.updateTeam(name, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-teams'] });
      toast.success(`团队 "${variables.name}" 更新成功`);
      addNotification({ type: 'success', title: '团队更新成功', message: `团队 "${variables.name}" 已更新` });
    },
    onError: (err, variables) => {
      toast.error(`团队 "${variables.name}" 更新失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: '团队更新失败', message: formatErrorMessage(err) });
    },
  });
}

// Human Mutations
export function useCreateHuman() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (data: CreateHumanRequest) => hiclawApi.createHuman(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-humans'] });
      queryClient.invalidateQueries({ queryKey: ['hiclaw-cluster-status'] });
      toast.success(`人类用户 "${variables.displayName}" 创建成功`);
      addNotification({ type: 'success', title: '用户创建成功', message: `用户 "${variables.displayName}" 已创建` });
    },
    onError: (err, variables) => {
      toast.error(`用户 "${variables.displayName}" 创建失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: '用户创建失败', message: formatErrorMessage(err) });
    },
  });
}

export function useDeleteHuman() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (name: string) => hiclawApi.deleteHuman(name),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-humans'] });
      queryClient.invalidateQueries({ queryKey: ['hiclaw-cluster-status'] });
      toast.success(`用户 "${name}" 已删除`);
      addNotification({ type: 'success', title: '用户已删除', message: `用户 "${name}" 已删除` });
    },
    onError: (err, name) => {
      toast.error(`用户 "${name}" 删除失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: '用户删除失败', message: formatErrorMessage(err) });
    },
  });
}

// Manager Mutations
export function useCreateManager() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (data: CreateManagerRequest) => hiclawApi.createManager(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-managers'] });
      toast.success(`Manager "${variables.name}" 创建成功`);
      addNotification({ type: 'success', title: 'Manager 创建成功', message: `Manager "${variables.name}" 已创建` });
    },
    onError: (err, variables) => {
      toast.error(`Manager "${variables.name}" 创建失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Manager 创建失败', message: formatErrorMessage(err) });
    },
  });
}

export function useDeleteManager() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (name: string) => hiclawApi.deleteManager(name),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-managers'] });
      toast.success(`Manager "${name}" 已删除`);
      addNotification({ type: 'success', title: 'Manager 已删除', message: `Manager "${name}" 已删除` });
    },
    onError: (err, name) => {
      toast.error(`Manager "${name}" 删除失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Manager 删除失败', message: formatErrorMessage(err) });
    },
  });
}

export function useUpdateManager() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: UpdateManagerRequest }) =>
      hiclawApi.updateManager(name, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-managers'] });
      toast.success(`Manager "${variables.name}" 更新成功`);
      addNotification({ type: 'success', title: 'Manager 更新成功', message: `Manager "${variables.name}" 已更新` });
    },
    onError: (err, variables) => {
      toast.error(`Manager "${variables.name}" 更新失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Manager 更新失败', message: formatErrorMessage(err) });
    },
  });
}

// Gateway Mutations
export function useCreateConsumer() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (data: CreateConsumerRequest) => hiclawApi.createConsumer(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-consumers'] });
      toast.success(`Consumer "${variables.name}" 创建成功`);
      addNotification({ type: 'success', title: 'Consumer 创建成功', message: `Consumer "${variables.name}" 已创建` });
    },
    onError: (err) => {
      toast.error(`Consumer 创建失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Consumer 创建失败', message: formatErrorMessage(err) });
    },
  });
}

export function useDeleteConsumer() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (id: string) => hiclawApi.deleteConsumer(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-consumers'] });
      toast.success(`Consumer 已删除`);
      addNotification({ type: 'success', title: 'Consumer 已删除', message: `Consumer ${id} 已删除` });
    },
    onError: (err) => {
      toast.error(`Consumer 删除失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Consumer 删除失败', message: formatErrorMessage(err) });
    },
  });
}

// Human Update Mutation
export function useUpdateHuman() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: UpdateHumanRequest }) =>
      hiclawApi.updateHuman(name, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hiclaw-humans'] });
      queryClient.invalidateQueries({ queryKey: ['hiclaw-cluster-status'] });
      toast.success(`用户 "${variables.name}" 更新成功`);
      addNotification({ type: 'success', title: '用户更新成功', message: `用户 "${variables.name}" 已更新` });
    },
    onError: (err, variables) => {
      toast.error(`用户 "${variables.name}" 更新失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: '用户更新失败', message: formatErrorMessage(err) });
    },
  });
}
