# 上游安装器漂移首份报告（2026-09-29，B3 验收）

- 上游：agentscope-ai/AgentTeams main @ 89562fb342564f83ed7c88c1d9d2f5f981897d41
- 本仓副本：install/agentteams-install.sh（4707 行）vs 上游（4965 行）
- diff 行数：695（阈值 50）→ 触发告警
- dashboard 段触碰：true → 触发告警

## 漂移构成（人工判读）

1. 本仓副本独有：Higress adapter 集成的 env 注释段（AGENTTEAMS_HIGRESS_ADAPTER_MODE / AI_GATEWAY_URL / AI_GATEWAY_ADMIN_URL / ADMIN_ALLOWED_HOSTS）——对应 AGENTTEAMS_PATCH.md 的 external adapter 参考实现（pending upstream PR），属预期差异
2. 上游独有：DeepSeek Harness runtime 镜像支持（AGENTTEAMS_DEEPSEEK_HARNESS_WORKER_VERSION / INSTALL_*_IMAGE 变量、安装步骤）——本仓副本落后，需评估同步；与 B2 的 deepseek-harness runtime 卡片口径呼应
3. 其余 695 行明细见 workflow artifact（cron 首跑后）或重跑：diff -u install/agentteams-install.sh <(curl -fsSL https://raw.githubusercontent.com/agentscope-ai/AgentTeams/main/install/agentteams-install.sh)
