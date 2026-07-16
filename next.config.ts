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

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  basePath,
  trailingSlash: true,
  allowedDevOrigins: [...devOrigins],
};

export default nextConfig;
