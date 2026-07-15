import { useMutation, useQueryClient } from '@tanstack/react-query';
import { agentteamsApi } from '@/lib/agentteams-api';
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
} from '@/lib/agentteams-api';
import { toast } from 'sonner';
import { useNotificationStore } from '@/lib/notification-store';
import { formatErrorMessage, isUnsupportedEndpointError } from '@/lib/api-error';
import { auditMutation } from '@/lib/audit-store';

function useNotify() {
  const addNotification = useNotificationStore((s) => s.addNotification);
  return addNotification;
}

// Worker Mutations
export function useCreateWorker() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (data: CreateWorkerRequest) => agentteamsApi.createWorker(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-workers'] });
      queryClient.invalidateQueries({ queryKey: ['agentteams-cluster-status'] });
      toast.success(`Worker "${variables.name}" 创建成功`);
      addNotification({ type: 'success', title: 'Worker 创建成功', message: `Worker "${variables.name}" 已创建` });
      auditMutation('worker', variables.name, 'create');
    },
    onError: (err, variables) => {
      toast.error(`Worker "${variables.name}" 创建失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Worker 创建失败', message: formatErrorMessage(err) });
      auditMutation('worker', variables.name, 'create-failed', formatErrorMessage(err), 'error');
    },
  });
}

export function useDeleteWorker() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (name: string) => agentteamsApi.deleteWorker(name),
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey: ['agentteams-workers'] });
      const previous = queryClient.getQueryData<WorkerResponse[]>(['agentteams-workers']);
      queryClient.setQueryData<WorkerResponse[]>(['agentteams-workers'], (old) =>
        old?.filter((w) => w.name !== name)
      );
      return { previous };
    },
    onError: (err, name, context) => {
      if (context?.previous) queryClient.setQueryData(['agentteams-workers'], context.previous);
      toast.error(`Worker "${name}" 删除失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Worker 删除失败', message: formatErrorMessage(err) });
    },
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-cluster-status'] });
      toast.success(`Worker "${name}" 已删除`);
      addNotification({ type: 'success', title: 'Worker 已删除', message: `Worker "${name}" 已删除` });
      auditMutation('worker', name, 'delete');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['agentteams-workers'] }),
  });
}

export function useUpdateWorker() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: UpdateWorkerRequest }) =>
      agentteamsApi.updateWorker(name, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-workers'] });
      queryClient.invalidateQueries({ queryKey: ['agentteams-worker-detail', variables.name] });
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
    mutationFn: (name: string) => agentteamsApi.wakeWorker(name),
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey: ['agentteams-workers'] });
      const previous = queryClient.getQueryData<WorkerResponse[]>(['agentteams-workers']);
      queryClient.setQueryData<WorkerResponse[]>(['agentteams-workers'], (old) =>
        old?.map((w) => w.name === name ? { ...w, phase: 'Pending' as WorkerPhase } : w)
      );
      return { previous };
    },
    onError: (err, name, context) => {
      if (context?.previous) queryClient.setQueryData(['agentteams-workers'], context.previous);
      toast.error(`Worker "${name}" 唤醒失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Worker 唤醒失败', message: formatErrorMessage(err) });
    },
    onSuccess: (_, name) => {
      toast.success(`Worker "${name}" 已唤醒`);
      addNotification({ type: 'success', title: 'Worker 已唤醒', message: `Worker "${name}" 已唤醒` });
      auditMutation('worker', name, 'wake');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['agentteams-workers'] }),
  });
}

export function useSleepWorker() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (name: string) => agentteamsApi.sleepWorker(name),
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey: ['agentteams-workers'] });
      const previous = queryClient.getQueryData<WorkerResponse[]>(['agentteams-workers']);
      queryClient.setQueryData<WorkerResponse[]>(['agentteams-workers'], (old) =>
        old?.map((w) => w.name === name ? { ...w, phase: 'Pending' as WorkerPhase } : w)
      );
      return { previous };
    },
    onError: (err, name, context) => {
      if (context?.previous) queryClient.setQueryData(['agentteams-workers'], context.previous);
      toast.error(`Worker "${name}" 休眠失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Worker 休眠失败', message: formatErrorMessage(err) });
    },
    onSuccess: (_, name) => {
      toast.success(`Worker "${name}" 已休眠`);
      addNotification({ type: 'success', title: 'Worker 已休眠', message: `Worker "${name}" 已休眠` });
      auditMutation('worker', name, 'sleep');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['agentteams-workers'] }),
  });
}

export function useEnsureReadyWorker() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (name: string) => agentteamsApi.ensureReadyWorker(name),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-workers'] });
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
    mutationFn: (data: CreateTeamRequest) => agentteamsApi.createTeam(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-teams'] });
      queryClient.invalidateQueries({ queryKey: ['agentteams-cluster-status'] });
      toast.success(`团队 "${variables.name}" 创建成功`);
      addNotification({ type: 'success', title: '团队创建成功', message: `团队 "${variables.name}" 已创建` });
      auditMutation('team', variables.name, 'create');
    },
    onError: (err, variables) => {
      toast.error(`团队 "${variables.name}" 创建失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: '团队创建失败', message: formatErrorMessage(err) });
      auditMutation('team', variables.name, 'create-failed', formatErrorMessage(err), 'error');
    },
  });
}

export function useDeleteTeam() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (name: string) => agentteamsApi.deleteTeam(name),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-teams'] });
      queryClient.invalidateQueries({ queryKey: ['agentteams-cluster-status'] });
      toast.success(`团队 "${name}" 已删除`);
      addNotification({ type: 'success', title: '团队已删除', message: `团队 "${name}" 已删除` });
      auditMutation('team', name, 'delete');
    },
    onError: (err, name) => {
      toast.error(`团队 "${name}" 删除失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: '团队删除失败', message: formatErrorMessage(err) });
      auditMutation('team', name, 'delete-failed', formatErrorMessage(err), 'error');
    },
  });
}

export function useUpdateTeam() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: UpdateTeamRequest }) =>
      agentteamsApi.updateTeam(name, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-teams'] });
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
    mutationFn: (data: CreateHumanRequest) => agentteamsApi.createHuman(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-humans'] });
      queryClient.invalidateQueries({ queryKey: ['agentteams-cluster-status'] });
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
    mutationFn: (name: string) => agentteamsApi.deleteHuman(name),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-humans'] });
      queryClient.invalidateQueries({ queryKey: ['agentteams-cluster-status'] });
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
    mutationFn: (data: CreateManagerRequest) => agentteamsApi.createManager(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-managers'] });
      toast.success(`Manager "${variables.name}" 创建成功`);
      addNotification({ type: 'success', title: 'Manager 创建成功', message: `Manager "${variables.name}" 已创建` });
      auditMutation('manager', variables.name, 'create');
    },
    onError: (err, variables) => {
      toast.error(`Manager "${variables.name}" 创建失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Manager 创建失败', message: formatErrorMessage(err) });
      auditMutation('manager', variables.name, 'create-failed', formatErrorMessage(err), 'error');
    },
  });
}

export function useDeleteManager() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: (name: string) => agentteamsApi.deleteManager(name),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-managers'] });
      toast.success(`Manager "${name}" 已删除`);
      addNotification({ type: 'success', title: 'Manager 已删除', message: `Manager "${name}" 已删除` });
      auditMutation('manager', name, 'delete');
    },
    onError: (err, name) => {
      toast.error(`Manager "${name}" 删除失败: ${formatErrorMessage(err)}`);
      addNotification({ type: 'error', title: 'Manager 删除失败', message: formatErrorMessage(err) });
      auditMutation('manager', name, 'delete-failed', formatErrorMessage(err), 'error');
    },
  });
}

export function useUpdateManager() {
  const queryClient = useQueryClient();
  const addNotification = useNotify();

  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: UpdateManagerRequest }) =>
      agentteamsApi.updateManager(name, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-managers'] });
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
    mutationFn: (data: CreateConsumerRequest) => agentteamsApi.createConsumer(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-consumers'] });
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
    mutationFn: (id: string) => agentteamsApi.deleteConsumer(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-consumers'] });
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
      agentteamsApi.updateHuman(name, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agentteams-humans'] });
      queryClient.invalidateQueries({ queryKey: ['agentteams-cluster-status'] });
      toast.success(`用户 "${variables.name}" 更新成功`);
      addNotification({ type: 'success', title: '用户更新成功', message: `用户 "${variables.name}" 已更新` });
    },
    onError: (err, variables) => {
      // AgentTeams v1.2.0-beta.1 has no PUT /api/v1/humans/{name} (405)
      const message = isUnsupportedEndpointError(err)
        ? '当前 Controller 版本（v1.2.0-beta.1）不支持编辑 Human，请通过删除后重建的方式修改'
        : formatErrorMessage(err);
      toast.error(`用户 "${variables.name}" 更新失败: ${message}`);
      addNotification({ type: 'error', title: '用户更新失败', message });
    },
  });
}
