import { readFileSync } from "node:fs";
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

// Stable per build invocation: generateBuildId writes it into .next/BUILD_ID
// (the server runtime reads that file back via lib/build-id) while the env
// entries inline the same value into the client bundle — so an already-open
// page can compare its own build against the redeployed server's.
const dashboardBuildId =
  process.env.DASHBOARD_BUILD_ID || `dash-${Date.now().toString(36)}`;
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
