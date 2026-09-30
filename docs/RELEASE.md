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
# 0. 三门 gates 全绿：tsc → eslint → vitest
#    （tsconfig include 含 **/*.ts，next.config.ts 等配置文件也在 tsc 覆盖范围）
# 1. bump package.json version（如 1.2.5-beta.5 → 1.2.5），提交
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
| 页面内嵌版本 vs 服务器版本 | `NEXT_PUBLIC_APP_VERSION` vs `/api/dashboard-build` 的 `version` | 不同 → 「发现新版本 v{服务器版本}」+「立即更新」（带 `?_b=` 时间戳穿透缓存刷新追平）；相同 → 「已是最新」（**构建号差异不提示**，同版本重建属已是最新） |
| 上游 release tag vs 内嵌 package.json version | GitHub `/releases/latest` | 高于 → 「上游有新版本」+ L1 可见的「热更新」入口 |
| 旧版服务器（接口无 `version` 字段） | buildId 兜底比对 | 不一致 → 「立即更新」（legacy 兼容分支） |

热更新完成判定同样以**版本号**为准：`updateContainer()` 轮询 `/api/dashboard-build`，version 变化即自动刷新（5 分钟超时）。

## 构建号确定性

- `next.config.ts` `resolveBuildId()` 三级回退：`DASHBOARD_BUILD_ID` env（CI / Makefile / `--build-arg`）→ git short sha → `.next/.build-id-lock` 锁文件（10 分钟有效，无 git 环境）。
- CI 镜像构建注入 `--build-arg DASHBOARD_BUILD_ID=${VERSION}`：**镜像构建号即版本号**。
- 背景：Turbopack client/server 编译各自独立加载 next.config，模块级时间戳被求值两次会造成一次构建内两个构建号（客户端内联 vs `.next/BUILD_ID` 文件），曾导致更新检测永久误报。
- 发布前自检：`cat .next/BUILD_ID` 与 `grep -rhoE "git-[0-9a-f]{7,10}" .next/static/chunks .next/server \| sort -u` 必须只有单一值。

## 已知坑

1. **忘 bump package.json** → 所有新页面误报上游新版本。
2. **忘上传 hotfix assets** → `/api/self-update` 返回 404「未附带热更新包」，此时只能走镜像部署。
3. **draft/prerelease** → 页面检查不到（`releases/latest` 只返回正式发布）。
4. **compose 镜像源** → 与 build.yml 发布源可能不一致，部署前核对 `image:` 字段。
5. **改 next.config.ts 忘跑 tsc** → tsconfig include 含 `**/*.ts`（覆盖配置文件），lint 不查重复 import，只有 `next build` 的 TypeScript 检查会拦；门禁必须三门（tsc → eslint → vitest）齐全。
6. **tag 没打在最终代码上**（改了配置又追加提交）→ 补丁包/镜像与 tag 不一致；需要 `git tag -f` + `git push -f origin vX.Y.Z` 重打，release 无需重建。
7. **gh release upload 大文件** → 前台执行会超时（慢上行），用后台任务；`GH_TOKEN` 从 workspace 目录取（gh 依赖 git credential）。
8. **hotfix bundle 的已知现象** → `.next/standalone` 根被 Turbopack 整项目 tracing 污染（`server-package.ts` 动态 `process.cwd()` 路径触发），bundle ~32M 含 workspace 杂文件；布局与容器 appDir 兼容，applyHotfix 校验不受影响。
