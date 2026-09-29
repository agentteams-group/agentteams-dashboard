import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Server-side build identity. `next build` writes a unique id into
 * .next/BUILD_ID (see generateBuildId in next.config.ts); the standalone
 * runtime ships that file, so reading it once per process tells every
 * dashboard instance which build it is serving. The value is cached for the
 * process lifetime — /api/dashboard-build must be stable per container.
 */

let cachedBuildId: string | null = null;
let cachedBuiltAt: string | undefined;
let warned = false;

function buildInfoDir(): string {
  // Overridable for tests (real-file fidelity beats mocking node builtins).
  return process.env.BUILD_INFO_DIR || join(process.cwd(), '.next');
}

function readBuildInfo(): void {
  if (cachedBuildId !== null) return;
  try {
    const file = join(buildInfoDir(), 'BUILD_ID');
    cachedBuildId = readFileSync(file, 'utf8').trim() || 'unknown';
    cachedBuiltAt = statSync(file).mtime.toISOString();
  } catch (error) {
    cachedBuildId = 'unknown';
    if (!warned) {
      warned = true;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[build-id] .next/BUILD_ID unreadable, reporting "unknown": ${message}`);
    }
  }
}

export function getServerBuildId(): string {
  readBuildInfo();
  return cachedBuildId ?? 'unknown';
}

export function getServerBuiltAt(): string | undefined {
  readBuildInfo();
  return cachedBuiltAt;
}

/** Test seam: drop the per-process cache between tests. */
export function resetBuildIdCacheForTests(): void {
  cachedBuildId = null;
  cachedBuiltAt = undefined;
  warned = false;
}
