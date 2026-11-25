import { Badge } from '@/components/ui/badge';
import {
  ARTIFACT_STATE_LABELS,
  type ArtifactStateInfo,
} from '@/lib/artifact-state';
import { CircleCheck, CircleDashed, Eye } from 'lucide-react';

const STATE_STYLE: Record<ArtifactStateInfo['state'], string> = {
  draft: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40',
  pending_review: 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/40',
  released: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40',
};

const STATE_ICON: Record<ArtifactStateInfo['state'], typeof CircleCheck> = {
  draft: CircleDashed,
  pending_review: Eye,
  released: CircleCheck,
};

/** 工件三态徽标（F1.3）：草稿 / 待审 / 已放行；带降级说明时 tooltip 透明呈现。 */
export function ArtifactStateBadge({ info }: { info: ArtifactStateInfo }) {
  const Icon = STATE_ICON[info.state];
  return (
    <Badge
      variant="outline"
      className={`text-xs gap-1 shrink-0 ${STATE_STYLE[info.state]}`}
      title={info.note}
    >
      <Icon className="h-2.5 w-2.5" aria-hidden="true" />
      {ARTIFACT_STATE_LABELS[info.state]}
    </Badge>
  );
}
