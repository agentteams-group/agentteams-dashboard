import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/humans/{name}/trash
//
// Read-only view of the human's recycle bin (`GET /api/v1/humans/{name}/trash`,
// human_files_handler.go listTrash). The controller returns
// `{entries: [{id, path, size, deletedAt, caller, role}]}`, newest first, with
// `path` still prefixed by `files/`. Restore/purge are NOT exposed here: the
// dashboard only browses the bin, restoring stays with the plugin.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const path = `/api/v1/humans/${encodeURIComponent(name)}/trash`;
  return proxyToAgentTeams(request, getControllerUrl(request), path, {
    forwardBody: false,
  });
}
