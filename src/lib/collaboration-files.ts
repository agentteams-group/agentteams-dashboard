import type { StorageObject, TeamResponse } from './agentteams-api';
import { apiUrl, requestJson } from './api-base';

export type CollaborationFileScope = { team: string } | { room: string; taskId?: string };

export function belongsToTeam(team: TeamResponse, user: string | null): boolean {
  return !!user && (team.admin?.name === user ||
    (team.humanMembers ?? []).some(member => (typeof member === 'string' ? member : member.name) === user));
}

export const CHAT_ATTACHMENT_DIRECTORY = '聊天附件/';

export function collaborationFilesUrl(scope: CollaborationFileScope, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params);
  if ('team' in scope) query.set('team', scope.team);
  else {
    query.set('room', scope.room);
    if (scope.taskId) query.set('taskId', scope.taskId);
  }
  return apiUrl(`/api/agentteams/collaboration-files?${query}`);
}

export function listCollaborationFiles(scope: CollaborationFileScope, prefix = '') {
  return requestJson<{ objects: StorageObject[]; root: string }>(collaborationFilesUrl(scope, { prefix }));
}

export async function uploadCollaborationFile(team: string, file: File, prefix: string) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(collaborationFilesUrl({ team }, { prefix }), { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `文件上传失败（${res.status}）`);
  return data as { key: string };
}
