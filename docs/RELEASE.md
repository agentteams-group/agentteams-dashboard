# 发版规范（AgentTeams-Dashboard）

> 本文档是发版流程的唯一权威来源；`.monkeycode/MEMORY.md` 仅存要点索引。

## 版本约定（三方一致，硬性）

```
git tag vX.Y.Z  =  package.json "version" X.Y.Z  =  本次构建的代码
```

- 发版前必须 bump `package.json`。漏 bump 的后果：新构建页面的「检查更新」每次都误报「上游有新版本」。
- release 用**三段**版本号（`v1.2.5`）。`compareSemver` 只比较三段，四段尾巴（如 `v1.2.4.10`）的差异检测不到。
- Release 必须是**正式发布**：draft 与 prerelease 不会被 `/releases/latest` 返回，页面永远看不到。

## 常规发版（镜像路径，canonical）

```bash
# 1. bump package.json version（如 1.2.4.9 → 1.2.5），提交
# 2. 打 tag 推送 —— build.yml 自动构建并发布镜像（vX.Y.Z + latest）
git tag vX.Y.Z && git push origin main --tags

# 3. 创建正式 Release
gh release create vX.Y.Z --generate-notes

# 4. 生成热更新包并上传（热补丁快速通道的载体）
npm run build
sh scripts/build-hotfix-bundle.sh vX.Y.Z
gh release upload vX.Y.Z \
  dashboard-hotfix-vX.Y.Z.tar.gz \
  dashboard-hotfix-vX.Y.Z.tar.gz.sha256

# 5. 服务器部署新镜像
docker compose pull && docker compose up -d
```

镜像发布链路：`build.yml`（tag 触发或手动 workflow_dispatch）→ `higress-registry.cn-hangzhou.cr.aliyuncs.com/agentteams/agentteams-dashboard:vX.Y.Z`。注意 `deploy/docker-compose.yml` 引用的是 `ghcr.io/...:latest`——以你实际拉取的源为准，必要时修改 compose 的 `image:` 字段。

## 热补丁快速通道（单实例快速修复）

- **前提**：目标 Release 已附带 hotfix assets（上方第 4 步）。
- **操作**：页面 设置 → 更新 → 检查更新 → 显示「上游有新版本」→ 点「热更新」（仅 L1 管理员可见）。
- **行为**：后端下载补丁包 → sha256 校验 → 热替换应用目录（旧版保留于 `app.prev`）→ 进程退出，由容器监管方拉起（docker restart 策略 / k8s restartPolicy）→ 页面轮询到新 buildId 自动刷新。全程约 1-3 分钟。
- **k8s 注意**：
  - 需可写根文件系统（放开 `readOnlyRootFilesystem`）；
  - 热补丁作用于接收请求的 Pod——**多副本以镜像滚动更新为准**，热补丁是单实例快速通道；
  - Pod 重建后补丁丢失是预期语义（下一次镜像构建包含同样代码，状态自然收敛）。
- **回滚**：常规回滚 = 重新部署旧版本镜像；`app.prev` 供紧急比对。
- **服务器网络**：需能访问 `api.github.com`（release 元数据）与 `github.com`（包下载）。二者不通时热更新不可用，但构建号追平（`/api/dashboard-build`）零影响。

## 更新检测语义（页面「设置 → 更新」）

| 对比 | 数据源 | 结果 |
|------|--------|------|
| 页面构建号 vs 服务器构建号 | 内嵌 BUILD_ID vs `/api/dashboard-build` | 「立即更新」= 页面刷新追平（镜像已换、页面未刷的场景） |
| 上游 release tag vs 内嵌 package.json version | GitHub `/releases/latest` | 「热更新」入口（L1）|

## 已知坑

1. **忘 bump package.json** → 所有新页面误报上游新版本。
2. **忘上传 hotfix assets** → `/api/self-update` 返回 404「未附带热更新包」，此时只能走镜像部署。
3. **draft/prerelease** → 页面检查不到（`releases/latest` 只返回正式发布）。
4. **compose 镜像源** → 与 build.yml 发布源可能不一致，部署前核对 `image:` 字段。
