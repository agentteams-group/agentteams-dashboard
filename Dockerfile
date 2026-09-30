# ============================================================
# AgentTeams-Dashboard - Production Dockerfile (Next.js standalone)
# ============================================================
# Build:
#   docker build -t agentteams-dashboard:latest .
# Run:
#   docker run -p 3000:3000 \
#     -e AGENTTEAMS_CONTROLLER_URL=http://agentteams-controller:8090 \
#     -e AGENTTEAMS_AI_GATEWAY_ADMIN_URL=http://agentteams-controller:8001 \
#     -e NEXT_PUBLIC_MATRIX_API_URL=http://matrix-local.agentteams.io:6167 \
#     agentteams-dashboard:latest

FROM node:22-alpine AS builder
WORKDIR /app

# Default basePath is empty for standalone deployment (served at root).
# Override at build time with --build-arg NEXT_PUBLIC_BASE_PATH=/dashboard for embedding.
ARG NEXT_PUBLIC_BASE_PATH=
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}

# Optional build-time default for the browser-side controller URL.
ARG NEXT_PUBLIC_AGENTTEAMS_CONTROLLER_URL=
ENV NEXT_PUBLIC_AGENTTEAMS_CONTROLLER_URL=${NEXT_PUBLIC_AGENTTEAMS_CONTROLLER_URL}

# Install native deps
ARG APK_MIRROR=mirrors.aliyun.com
RUN sed -i "s|dl-cdn.alpinelinux.org|${APK_MIRROR}|g" /etc/apk/repositories && \
    apk add --no-cache ca-certificates

# Install dependencies (lockfile included for reproducible builds)
# NOTE: If Docker bridge DNS is broken, build with --network=host to use host networking.
ARG NPM_REGISTRY=https://registry.npmmirror.com
COPY package.json package-lock.json ./
RUN npm config set registry "${NPM_REGISTRY}" && \
    npm ci --no-audit --no-fund --legacy-peer-deps

# Copy source and build
# DASHBOARD_BUILD_ID pins one build id across every config load inside the
# build (client/server workers load next.config independently); without it
# the build falls back to git sha, unavailable in the docker context.
ARG DASHBOARD_BUILD_ID=
ENV DASHBOARD_BUILD_ID=${DASHBOARD_BUILD_ID}
COPY . .
RUN npm run build

# ============================================================
# Runtime image
# ============================================================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# Next.js 15+ standalone server defaults to localhost; bind to all interfaces for LAN access.
ENV HOSTNAME=0.0.0.0

ARG APK_MIRROR=mirrors.aliyun.com
RUN sed -i "s|dl-cdn.alpinelinux.org|${APK_MIRROR}|g" /etc/apk/repositories && \
    apk add --no-cache ca-certificates

# Create non-root user and persistent data directory
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /app/db && \
    chown -R nextjs:nodejs /app

# Copy standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
