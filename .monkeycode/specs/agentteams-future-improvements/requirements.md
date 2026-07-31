# AgentTeams 未来改进需求规格文档（EARS 格式）

Feature Name: agentteams-future-improvements  
Updated: 2026-07-31  

## 1. 引言

### 1.1 范围
本需求文档涵盖 AgentTeams Dashboard 五大核心改进方向的性能监控、告警集成、批量操作、新手引导和 OAuth 登录。所有需求均基于对现有代码库的分析，采用 EARS（Easy Approach to Requirements Syntax）模式编写，以确保需求的清晰性、可测试性和无歧义性。

### 1.2 术语表

| 术语 | 定义 |
|------|------|
| **Agent** | 指代系统中的 Worker、Team、Manager、Human 等实体统称 |
| **Insight** | insights-engine 自动检测到的问题/异常事件 |
| **Notification Channel** | 通知接收的媒介（Matrix、Slack、Email） |
| **Batch Workflow** | 多步骤操作的编排序列 |
| **OAuth Provider** | 第三方身份提供商（GitHub、Google 等） |

---

## 2. 性能监控指标需求

### Requirement 2.1：实时资源指标采集

**User Story：** AS a cluster administrator, I want real-time CPU and memory metrics for each Worker, so that I can identify performance bottlenecks quickly.

#### Acceptance Criteria

1. WHEn a Worker loads in the detail page, the system SHALL fetch resource metrics from `/api/agents/{name}/metrics` endpoint.
2. WHILE monitoring is active, the system SHALL update the CPU/Memory charts every 5 seconds with fresh data points.
3. IF the metrics endpoint returns no data, the chart SHALL display "No available metrics" message instead of crashing.
4. THE system SHALL show at least the last 60 minutes of metric history when viewing a Worker's resource usage.

### Requirement 2.2：历史趋势查询

**User Story：** AS an operator, I need to view historical CPU trends over longer periods, so that I can spot patterns and plan capacity.

#### Acceptance Criteria

1. WHEN the user selects a different time range (1h / 6h / 24h / 7d) in the metrics picker, the system SHALL query the backend with corresponding start/end timestamps.
2. THE system SHALL aggregate metrics into appropriate intervals (e.g., 1-point-per-minute for 1h, 1-point-per-hour for 24h).
3. IF the requested time range exceeds the retained historical period, the system SHALL return only available data without error.

### Requirement 2.3：全局 KPI 摘要卡片

**User Story：** AS a dashboard viewer, I want at-a-glance numbers about overall cluster health and resource utilization on the Overview page.

#### Acceptance Criteria

1. ON page load, the Overview section SHALL display three KPI cards: "Average Health Score", "Total CPU Usage (%)", and "Total Memory Used (GB)".
2. WHILE the overview page is refreshed (via auto-refresh or manual), the KPI values SHALL update within 2 seconds.
3. IF any metric cannot be calculated (e.g., no Workers), the card SHALL show "N/A" rather than throwing an error.

---

## 3. 告警系统需求

### Requirement 3.1：告警规则配置

**User Story：** AS a team lead, I want to configure which Insights trigger notifications and through which channels, so that I only receive alerts that matter to me.

#### Acceptance Criteria

1. WHEN a user opens the Alert Settings page, the system SHALL load all existing AlertRule records from `/api/settings/alerts`.
2. WHILE creating a new rule, the system SHALL require selection of at least one insight type and one notification channel.
3. IF a user sets a throttleMinutes value of 5 for a critical alert, the system SHALL not send another notification of the same type within 5 minutes.
4. THE system SHALL validate that email addresses and Slack webhook URLs follow correct formats before saving.

### Requirement 3.2：多渠道通知发送

**User Story：** WHEN a critical issue occurs, I need it notified through multiple channels simultaneously, so that I don't miss it even if I'm away from one platform.

#### Acceptance Criteria

1. WHEN an Insight with severity "critical" is detected, the system SHALL send notifications to ALL channels listed in the matching alert rule.
2. IF one notification channel fails (e.g., Slack webhook unreachable), the system SHALL retry twice with exponential backoff AND continue attempting other channels.
3. THE payload sent to each channel SHALL contain: title, description, severity color code, and a deep-link URL to the specific Worker/Team detail page.
4. AFTER successful delivery, the system SHALL log the notification event with timestamp and channel name for audit.

### Requirement 3.3：告警去重与抑制

**User Story：** AS someone who gets tired of seeing the same alert repeatedly, I want the system to consolidate repeated incidents into a single updated notification.

#### Acceptance Criteria

1. WHEN two identical insights (same insightId, same entity) are detected within the throttleMinutes window, the system SHALL NOT send a second notification.
2. IF a new insight arrives while a previous one is still active, the system SHALL update the existing notification with the latest information instead of creating a duplicate.
3. THE suppression window SHALL be configurable per-rule (default: 5 minutes for critical, 15 minutes for warning).

---

## 4. 批量操作编排需求

### Requirement 4.1：工作流可视化编辑

**User Story：** AS an operations engineer, I want to drag-and-drop steps to build a multi-action workflow, so that I don't have to write code to coordinate complex batch operations.

#### Acceptance Criteria

1. WHEN the user drags a "Select Workers" node onto the canvas, the system SHALL display a modal to choose the target Workers and filters.
2. WHEN the user drags a "Wake" action node after a Select node, the system SHALL automatically pass the selected Worker names as input to the Wake action.
3. THE canvas SHALL support reordering steps by drag-and-drop, and the order change SHALL be reflected in the generated workflow execution sequence.
4. IF a user deletes a step, the system SHALL re-index remaining steps to maintain continuous ordering.

### Requirement 4.2：Dry-run 预览模式

**User Story：** Before executing a destructive operation like batch delete, I want to see exactly what will happen without making any actual changes, so that I can prevent mistakes.

#### Acceptance Criteria

1. WHEN the user clicks "Dry Run" on a saved workflow, the system SHALL execute each step in read-only mode and display the expected outcome.
2. The dry-run results SHALL list: how many Workers would be selected, which ones would wake/sleep/ensure-ready, and any validation failures.
3. IF a validation step would reject some Workers (e.g., already Running), the dry-run report SHALL highlight those with status "Would be skipped".
4. THE dry-run shall NOT modify any actual Worker state or persist any results beyond the current session.

### Requirement 4.3：进度跟踪与日志

**User Story：** When running a long-running batch operation across many Workers, I want to see real-time progress and any errors, so that I know the operation is proceeding correctly.

#### Acceptance Criteria

1. WHILE a workflow is executing, the UI SHALL show a progress bar indicating current step number and percentage completed.
2. FOR each executed step, the system SHALL display a log entry with timestamp, action name, affected Worker names, and success/failure status.
3. IF any step fails, the system SHALL pause execution (optional: ask user to continue/skip/fail entire workflow) AND highlight the failed step in red.
4. AFTER completion, the system SHALL keep the last 10 executed workflow histories accessible from the Batch Operations hub.

---

## 5. 新手引导需求

### Requirement 5.1：首次访问引导流程

**User Story：** AS a first-time user, I want a guided tour that explains where to click and what each part does, so that I can start using the system confidently.

#### Acceptance Criteria

1. UPON first login (detected via localStorage flag), the system SHALL automatically start the onboarding tour on the Overview page.
2. EACH step of the tour SHALL highlight a specific UI element (sidebar navigation, search box, worker table) with a short explanation tooltip.
3. WHEN the user clicks "Next", the system SHALL move to the next step; clicking "Skip" SHALL complete the tour and set the finished flag.
4. THE tour SHALL be restartable from Settings at any time for users who need a refresher.

### Requirement 5.2：上下文帮助按钮

**User Story：** While looking at a specific page, I want quick access to relevant documentation without leaving the screen, so that I can understand features in context.

#### Acceptance Criteria

1. ON every section page (Workers, Teams, Chat, etc.), the SectionHeader SHALL include a "?" help button on the right side.
2. WHEN the user clicks the help button, the system SHALL display a small popover with: 1-sentence purpose of this section, 3 key actions they can perform, and a link to detailed docs.
3. THE content of the help popover SHALL be configurable per-section via a mapping object in configuration.
4. Clicking outside the popover OR pressing ESC SHALL close it without side effects.

### Requirement 5.3：快捷键提示

**User Story：** I want to know the keyboard shortcuts available so that I can work more efficiently without constantly reaching for the mouse.

#### Acceptance Criteria

1. IN the Command Palette overlay (when opened), the bottom-left corner SHALL permanently display "⌘ / Ctrl + K" as the open shortcut.
2. WHEN the user presses ?, the system SHALL show a modal listing all supported shortcuts (Command Palette, Search, Refresh, etc.).
3. THE shortcut display SHALL respect platform (show ⌘ on macOS, Ctrl on Windows/Linux).
4. Users CAN customize the Command Palette open key in Settings, and the display SHALL update accordingly.

---

## 6. OAuth 登录需求

### Requirement 6.1：第三方登录入口

**User Story：** I prefer to use my existing GitHub or Google account instead of remembering another password, so I want those options available on the login page.

#### Acceptance Criteria

1. ON the Matrix Login Page, there SHALL be a horizontal divider followed by "Continue with" section containing buttons for each configured OAuth provider.
2. WHEN a user clicks "Continue with GitHub", the system SHALL redirect to the GitHub OAuth authorization URL with the correct callback endpoint.
3. UPON successful OAuth callback, the system SHALL create or associate a local AgentTeams user session and redirect to the default section (Overview).
4. IF the user already has a local Matrix account with the same email from OAuth, the system SHALL automatically link them without requiring password re-entry.

### Requirement 6.2：身份关联与管理

**User Story：** As an admin, I want to see which login methods each user has enabled, so that I can manage access policies appropriately.

#### Acceptance Criteria

1. IN the User Management interface (accessible to admins), each user record SHALL display their auth method (Matrix / GitHub / Google).
2. WHEN an admin revokes an OAuth provider's access, future logins using that provider SHALL be blocked, but existing sessions SHALL remain valid until expiration.
3. THE system SHALL allow users to disconnect linked OAuth accounts in their Profile settings, reverting to Matrix password authentication only.
4. NEW user registrations via OAuth SHALL require email verification before full access is granted (configurable setting).

### Requirement 6.3：安全策略

**User Story：** I need to ensure that only authorized personnel can access the system through any login method, so security policies must be consistently enforced.

#### Acceptance Criteria

1. ALL OAuth callbacks SHALL be validated against configured allowed domains and issuer URLs to prevent spoofing.
2. THE session created after OAuth authentication SHALL have the same timeout and refresh policy as Matrix-authenticated sessions.
3. IF a user has Two-Factor Authentication enabled in their organization, OAuth login SHALL require completing the 2FA challenge before granting access.
4. FAILED OAuth attempts SHALL be logged with IP address and timestamp for security auditing.

---

## 7. 集成与互操作性需求

### Requirement 7.1：Slack slash command 支持

**User Story：** In my daily Slack workflow, I want to check Worker status without leaving Slack, so I can use simple slash commands directly in chat.

#### Acceptance Criteria

1. WHEN the user types `/worker-status <worker-name>` in Slack, the Slack app SHALL query the AgentTeams API and return a formatted response with phase, health score, and last message.
2. THE command SHALL work only for users whose Matrix identity is linked to their Slack account (via OAuth or manual linking).
3. IF the Worker doesn't exist or is unknown, Slack SHALL return a friendly error message: "Worker 'xyz' not found."
4. THE system SHALL rate-limit `/worker-status` calls to 10 per minute per user to prevent abuse.

### Requirement 7.2：Webhook 事件接收

**User Story：** I want external systems (like CI/CD pipelines) to trigger actions in AgentTeams, such as rolling out a new model to Workers, so I need inbound webhook endpoints.

#### Acceptance Criteria

1. THE system SHALL provide a POST `/api/webhooks` endpoint that accepts signed payloads from trusted sources.
2. WHEN a valid webhook event (e.g., `github.push`) is received, the system SHALL execute the pre-configured action (e.g., restart all Workers with a specific tag).
3. THE signature verification SHALL use a HMAC-SHA256 secret stored in settings; invalid signatures SHALL be rejected with 401.
4. EVERY webhook receipt SHALL be recorded in an audit log with sender IP, timestamp, event type, and result (accepted/rejected).

---

## 8. 非功能需求

### Performance

- P99 page load time for Workers List shall be under 1.5s on a connection with 100 Workers.
- Chart rendering for 60 minutes of metrics at 1-min granularity shall complete within 2 seconds.

### Security

- All API endpoints requiring authentication shall validate JWT/session tokens.
- OAuth client secrets and webhook signing keys shall be encrypted at rest in the database.
- Error messages shall not expose stack traces or internal paths to clients.

### Reliability

- Notification service shall have 99.9% availability; failures shall be queued and retried.
- Metrics collection shall not cause Agent Controller CPU usage to exceed additional 5%.

### Maintainability

- All new components shall be documented in `.monkeycode/docs/` with usage examples.
- TypeScript shall be fully typed; no `any` type shall be introduced in new code.

---

## 9. 附录：需求追溯矩阵

| Requirement ID | Feature Area | Priority | Implementation Status |
|----------------|--------------|----------|----------------------|
| 2.1 | Real-time metrics | High | Design complete |
| 2.2 | Historical trend query | High | Design complete |
| 2.3 | Global KPI cards | Medium | Design complete |
| 3.1 | Alert rule config | High | Design complete |
| 3.2 | Multi-channel notification | High | Design complete |
| 3.3 | Deduplication & suppression | Medium | Design complete |
| 4.1 | Visual workflow editor | High | TBD |
| 4.2 | Dry-run preview | Medium | TBD |
| 4.3 | Progress tracking & logs | Medium | TBD |
| 5.1 | Onboarding tour | Low | TBD |
| 5.2 | Contextual help (?) | Low | TBD |
| 5.3 | Shortcut hints | Low | TBD |
| 6.1 | OAuth login buttons | Medium | TBD |
| 6.2 | Identity management | Low | TBD |
| 6.3 | Security policies | High | TBD |
| 7.1 | Slack slash commands | Low | TBD |
| 7.2 | Webhook receiver | Low | TBD |

*Status: "Design complete" means requirements specified and design doc written; "TBD" requires further decomposition into tasks.*

---

*由 MonkeyCode AI Agent 自动生成 | 遵循 EARS 语法规范与 INCOSE 语义质量规则*
