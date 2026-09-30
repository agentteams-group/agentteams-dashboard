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

## 应用内热更新说明（设置 → 更新）

热更新为纯应用层实现（L1 管理员触发，下载最新 Release 的
`dashboard-hotfix-*.tar.gz` 校验后热替换应用文件并自动重启），无
docker socket、无旁路容器，docker run / compose / k8s 行为一致。
使用前提：

1. **Release 附带热更新包**：发布时执行
   `npm run build && sh scripts/build-hotfix-bundle.sh vX.Y.Z`，把
   生成的 `.tar.gz` 与 `.tar.gz.sha256` 作为 Release assets 上传。
2. **可写根文件系统**：k8s 部署需放开 `readOnlyRootFilesystem`；
   热替换发生在容器文件系统内。
3. **单副本语义**：热更新作用于接收请求的 Pod；多副本场景请以镜像
   滚动更新为准（热更新是单实例快速通道，下一次镜像构建会包含同样
   的代码，Pod 重建后状态收敛）。
4. **回滚**：应用目录保留上一版本于 `app.prev`；常规回滚走重新部署
   旧版本镜像。
5. Coolify 的 webhook/重新部署链路与热更新互不冲突，可并行使用。
