import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// Collect allowed dev origins from env or use wildcard pattern for space-z.ai previews
const devOrigins = process.env.ALLOWED_DEV_ORIGINS
  ? process.env.ALLOWED_DEV_ORIGINS.split(",")
  : [];

// monkeycode-ai.online preview domain pattern
devOrigins.push(".monkeycode-ai.online");

// Base path for embedding AgentTeams-Dashboard as a sub-application (e.g. /dashboard).
// When empty/unset, AgentTeams-Dashboard runs at the root as a standalone app.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/**
 * One build id per build — deterministic across every process that loads
 * this config. Turbopack compiles client and server in separate workers and
 * each independently imports next.config.ts; a time-based id would get two
 * different values (client inline vs .next/BUILD_ID on disk), which split
 * the update check into a permanent false mismatch. Resolution order:
 *  1. DASHBOARD_BUILD_ID env (CI / Makefile / docker build-arg — pinned to
 *     the release version)
 *  2. git short sha (local builds; identical on every re-load)
 *  3. lock file under .next/ shared by config loads within 10 minutes
 *     (no-git environments such as docker builds without a build-arg)
 */
function resolveBuildId(): string {
  if (process.env.DASHBOARD_BUILD_ID) return process.env.DASHBOARD_BUILD_ID;
  try {
    return `git-${execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim()}`;
  } catch {
    /* no git — fall through to the lock file */
  }
  try {
    const nextDir = join(process.cwd(), ".next");
    const lockFile = join(nextDir, ".build-id-lock");
    if (existsSync(lockFile)) {
      const raw = JSON.parse(readFileSync(lockFile, "utf8")) as {
        id?: string;
        at?: number;
      };
      if (raw.id && typeof raw.at === "number" && Date.now() - raw.at < 10 * 60_000) {
        return raw.id;
      }
    }
    const id = `dash-${Date.now().toString(36)}`;
    mkdirSync(nextDir, { recursive: true });
    writeFileSync(lockFile, JSON.stringify({ id, at: Date.now() }));
    return id;
  } catch {
    return `dash-${Date.now().toString(36)}`;
  }
}

const dashboardBuildId = resolveBuildId();
const dashboardBuiltAt = new Date().toISOString();

let dashboardAppVersion = "0.0.0";
try {
  const pkg = JSON.parse(readFileSync("./package.json", "utf8")) as {
    version?: string;
  };
  if (pkg.version) dashboardAppVersion = pkg.version;
} catch {
  /* keep the fallback version */
}

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  basePath,
  trailingSlash: true,
  allowedDevOrigins: [...devOrigins],
  generateBuildId: () => dashboardBuildId,
  env: {
    NEXT_PUBLIC_BUILD_ID: dashboardBuildId,
    NEXT_PUBLIC_BUILT_AT: dashboardBuiltAt,
    NEXT_PUBLIC_APP_VERSION: dashboardAppVersion,
  },
};

export default nextConfig;
