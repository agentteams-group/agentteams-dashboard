import { NextResponse } from 'next/server';
import { DASHBOARD_REPOSITORY } from '@/lib/dashboard-runtime';

export const dynamic = 'force-dynamic';

/**
 * Latest upstream release info for the two projects shown on the Overview
 * "运行信息" card. Fetched server-side from the GitHub REST API with a
 * 1-hour fetch cache so the shared server IP stays far below GitHub's
 * 60 req/hr unauthenticated rate limit.
 *
 * Lookup order per repo: /releases/latest (tag_name) first; repos without
 * GitHub Releases (e.g. image-only dashboards) fall back to /tags[0].
 */

export interface LatestVersionInfo {
  /** Normalized version without the leading "v" (e.g. "1.2.2"). */
  version: string;
  /** Release/tag page URL for the hyperlink. */
  url: string;
}

interface GithubRelease {
  tag_name?: string;
  html_url?: string;
}

interface GithubTag {
  name?: string;
}

const AGENTTEAMS_REPO = 'agentscope-ai/AgentTeams';
const DASHBOARD_REPO = 'agentteams-group/agentteams-dashboard';

function stripLeadingV(tag: string): string {
  return tag.trim().replace(/^v/i, '');
}

async function githubFetch(path: string): Promise<unknown | null> {
  try {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'agentteams-dashboard',
      },
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    // Network error / timeout / rate limited — render "未知" in the UI.
    return null;
  }
}

async function fetchLatestVersion(repo: string): Promise<LatestVersionInfo | null> {
  const release = await githubFetch(`/repos/${repo}/releases/latest`);
  if (release && typeof release === 'object') {
    const { tag_name: tagName, html_url: htmlUrl } = release as GithubRelease;
    if (typeof tagName === 'string' && tagName.trim() !== '') {
      return {
        version: stripLeadingV(tagName),
        url: typeof htmlUrl === 'string' && htmlUrl ? htmlUrl : `https://github.com/${repo}/releases`,
      };
    }
  }

  // No published Release (404) — fall back to the newest git tag.
  const tags = await githubFetch(`/repos/${repo}/tags?per_page=1`);
  if (Array.isArray(tags) && tags.length > 0 && tags[0] && typeof tags[0] === 'object') {
    const tagName = (tags[0] as GithubTag).name;
    if (typeof tagName === 'string' && tagName.trim() !== '') {
      return {
        version: stripLeadingV(tagName),
        url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tagName)}`,
      };
    }
  }
  return null;
}

export async function GET() {
  const [agentteams, dashboard] = await Promise.all([
    fetchLatestVersion(AGENTTEAMS_REPO),
    fetchLatestVersion(DASHBOARD_REPO),
  ]);
  return NextResponse.json({
    agentteams,
    dashboard,
    // Static repo homepages so the card can hyperlink even when the
    // version lookup fails.
    repositories: {
      agentteams: `https://github.com/${AGENTTEAMS_REPO}`,
      dashboard: DASHBOARD_REPOSITORY,
    },
  });
}
