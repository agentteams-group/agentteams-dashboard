import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentteamsApi } from '@/lib/agentteams-api';
import type { SkillEntry } from '@/lib/skill-center-types';

export function useSkills(search?: string, source?: 'custom' | 'nacos' | 'builtin' | null, page?: number, pageSize?: number) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (source) params.set('source', source);
  if (page) params.set('page', String(page));
  if (pageSize) params.set('pageSize', String(pageSize));
  const query = params.toString();

  return useQuery<{ skills: SkillEntry[]; total: number }, Error>({
    queryKey: ['agentteams-skills', query],
    queryFn: () => agentteamsApi.listSkills(query),
    placeholderData: { skills: [], total: 0 },
    throwOnError: false,
  });
}

export function useSkill(name: string) {
  return useQuery<SkillEntry | null>({
    queryKey: ['agentteams-skill', name],
    queryFn: () => agentteamsApi.getSkill(name).catch(() => null),
    enabled: !!name,
    placeholderData: null,
    throwOnError: false,
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, overwrite = false }: { file: File; overwrite?: boolean }) =>
      agentteamsApi.createSkill(file, overwrite),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agentteams-skills'] });
    },
  });
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: { description?: string; version?: string } }) =>
      agentteamsApi.updateSkill(name, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agentteams-skills'] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => agentteamsApi.deleteSkill(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agentteams-skills'] });
    },
  });
}
