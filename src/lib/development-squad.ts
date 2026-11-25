import { agentteamsApi } from './agentteams-api';
import { matrixApi } from './matrix-api';
import { useMatrixStore } from './matrix-store';
import { DEVELOPMENT_ROLES } from './development-squad-template';
export { DEVELOPMENT_ROLES } from './development-squad-template';

export interface SquadDeploymentRequest { name: string; repository: string; model?: string; requestId: string }
export interface SquadDeploymentResult { teamName: string; managerName: string; roomId: string; eventId: string }

export function developmentSquadNameError(name: string): string | null {
  return /^[a-z](?:[a-z0-9-]{0,8}[a-z0-9])?$/.test(name)
    ? null : '使用 1–10 位小写字母、数字或连字符，以字母开头，以字母或数字结尾。';
}

export function developmentSquadRepositoryError(repository: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/.test(repository)
    ? null : '填写 GitHub 仓库，格式为 owner/repository。';
}

export function developmentSquadPrompt(request: SquadDeploymentRequest): string {
  return `请部署开发小队，持久记录请求 ${request.requestId}，不要重复创建资源。
请先读取官网角色清单 https://agentteams.cloud/skills/development-squad/manifest.json，按清单中的相对路径获取四份角色 Skill。使用你现有的资产管理、Worker 管理和团队管理工具完成部署，不依赖额外安装名为 development-squad 的 Skill。
小队标识：${request.name}
负责仓库：https://github.com/${request.repository}
四个角色统一使用 Codex runtime（codex），包括 Leader、开发、代码评审、测试。
${request.model?.trim() ? `四个 Agent 统一指定模型：${request.model.trim()}。先验证可用，失败时报告阻塞，不要换模型。` : '创建时使用当前集群默认模型；需要显式填写模型字段时先读取当前默认值。'}

请拉取角色 Skill、同步到部署资产库、分发并关联 Skill、创建 Team 并等待四个 Agent 就绪。已有同名资产保留编辑；无关同名资源不得覆盖；失败后可继续，报告实际步骤和阻塞。
创建前核实四个角色均可访问负责仓库，沿用已配置的 GitHub 授权访问方式；缺少权限时报告阻塞，不在消息或提示词中复制访问密钥。
角色对应：${DEVELOPMENT_ROLES.map(role => `${request.name}-${role.id} → ${role.skillName}`).join('；')}。

将负责仓库和 Issue 跟进记录保存到 Leader 的共享业务上下文。使用现有主动助手公共协议，为当前 Team Admin 配置每 30 分钟一次的只读检查，首次立即扫描。
发现新 Issue 时由 Leader 发送带原始链接、标题和判断依据的待确认提示；没有新信息时提交 skipped 回执。未确认时不得创建 Task、派发开发或创建 PR。
只有授权用户明确确认某个 Issue 后，才为它创建一条稳定 ID 的主 Task；同一仓库和 Issue 复用该 Task，开发、评审和测试用执行子任务跟进，不再创建 Leader 或新团队。
确认后分析 Bug、检查所有状态的对应 PR。Bug 成立且未发现对应 PR 时进入开发 → 独立评审 → 测试 → Leader 验收；信息不足或已有 PR 时报告并停止重复开发。新提交必须重新评审和测试。
部署请求不授权推送代码、创建 PR、合并或公开评论；具体 Issue 任务的发布授权另行核对。
请在本会话报告小队、角色、模型、Skill 资产、仓库绑定与提醒配置的实际结果。若官网角色清单、公共管理工具或主动助手接口不可用，请明确报告阻塞，不要假装已完成。`;
}

/** The Dashboard submits intent; the Manager owns provisioning and its receipts. */
export async function deployDevelopmentSquad(request: SquadDeploymentRequest): Promise<SquadDeploymentResult> {
  const invalid = developmentSquadNameError(request.name) ?? developmentSquadRepositoryError(request.repository);
  if (invalid) throw new Error(invalid);
  if (request.model?.trim() && !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(request.model.trim())) throw new Error('请填写有效的模型名称。');
  const { homeserver, accessToken, isLoggedIn } = useMatrixStore.getState();
  if (!isLoggedIn || !homeserver || !accessToken) throw new Error('请先连接对话，再交给 Manager 部署。');
  const manager = (await agentteamsApi.listManagers()).find(item => item.name === 'default');
  if (!manager?.roomID || !manager.matrixUserID || manager.phase !== 'Running') throw new Error('默认 Manager 尚未就绪，请在助手页面检查状态。');
  const joined = await matrixApi.getJoinedRooms(homeserver, accessToken);
  if (!joined.joined_rooms.includes(manager.roomID)) throw new Error('当前账号尚未加入 Manager 会话，请先在助手页面连接。');
  const receipt = await matrixApi.sendMessage(homeserver, accessToken, manager.roomID, developmentSquadPrompt(request), {
    mentions: { user_ids: [manager.matrixUserID] },
  });
  return { teamName: request.name, managerName: manager.name, roomId: manager.roomID, eventId: receipt.event_id };
}
