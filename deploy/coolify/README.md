# Coolify 部署（D5）

Dashboard 是单个无状态容器（持久化仅 `/data/agentteams-dashboard` 的会话密钥与回放包），Coolify 直接用 Docker Compose/Dockerfile 部署即可。

## 步骤

1. Coolify → New Resource → Docker Compose，粘贴本目录上级的 `deploy/docker-compose.yml` 内容，或选 Dockerfile 从 Git 仓库构建。
2. 在 Environment Variables 里填齐：
   - `AGENTTEAMS_CONTROLLER_URL`（Controller 地址，容器网络可达）
   - `AGENTTEAMS_FS_ENDPOINT` / `AGENTTEAMS_FS_BUCKET` / `AGENTTEAMS_FS_ACCESS_KEY` / `AGENTTEAMS_FS_SECRET_KEY`（存储凭证；安装器探测链同名变量：`FS_*` → `MINIO_*` → `RUSTFS_*`）
   - `NEXT_PUBLIC_MATRIX_API_URL`（Homeserver 地址）
   - 可选：`AGENTTEAMS_AI_GATEWAY_URL` / `AGENTTEAMS_AI_GATEWAY_ADMIN_URL`（AI 网关）
3. 挂载持久卷到 `/data/agentteams-dashboard`（会话密钥 0600 落盘于此，重启后 Cookie 仍有效）。
4. Domain 绑定后建议开启 Coolify 的反代 HTTPS（浏览器侧 Secure Cookie 由 `DASHBOARD_COOKIE_SECURE=1` 开启）。

## 只读 demo 注意事项（D5 安全前提）

公开 demo 必须满足：独立后端（不连真实集群）、只读观察者账号（session level 1）、反代限速。
三项无法同时保证时，降级为 README 的 30 秒安装 GIF（录制清单见 `docs/images/README.md`）。
