'use client';

import { ProjectStatusBadge } from './status-views';
import type { ProjectSummary } from '@/lib/agentteams-projects-api';

// ----- Project card (card view) -----

export function ProjectCard({
  project,
  selected,
  onSelect,
}: {
  project: ProjectSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-lg border p-3 text-xs transition-colors ${
        selected
          ? 'border-primary/50 bg-primary/5'
          : 'border-muted hover:bg-muted/50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold truncate">{project.title}</span>
        <ProjectStatusBadge status={project.status} />
      </div>
      <p className="text-[10px] text-muted-foreground font-mono mt-1 truncate">
        {project.project_id}
      </p>
      <p className="text-[10px] text-muted-foreground mt-1">
        {project.team_id ? `团队 ${project.team_id} · ` : ''}
        {project.plan_type ?? 'dag'} · {project.mode ?? 'project'}
      </p>
    </button>
  );
}
