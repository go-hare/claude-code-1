# v2.1.290 Checklist Scan — Batch F (#161–#190)

- **Checklist**: `docs/upstream-extraction/v2.1.290-325/official-290-325-checklist.md` (lines 182–211)
- **Official SEA binary**: `/tmp/official-325/plat/package/claude` (v2.1.325)
- **Local repo**: `src/` and `packages/builtin-tools/`

## Summary Counts

| 状态 | 数量 | 条目 |
| --- | ---: | --- |
| HAVE | 0 | — |
| PARTIAL | 1 | #175 |
| GAP | 3 | #161, #162, #163 |
| N/A | 26 | #164–#174 (VSCode), #176–#178 (Cloud UI/Backend), #179 (Remote Control Web Menu), #180–#188 (Claude Tag / Slack), #189–#190 (GitHub Code Review App) |
| UNKNOWN | 0 | — |
| **Total** | **30** | **#161–#190** |

## Detailed Findings

| # | 状态 | 本地文件/符号 | SEA 关键词/片段摘要 | 差异说明 |
| --- | --- | --- | --- | --- |
| 161 | **GAP** | `src/utils/agentProxy/ghShim.ts` (`buildGhShimScript`), `src/upstreamproxy/agentProxyPrompt.ts` | `@302508984`: 内置 JS `gh` 客户端 (`"Claude Code's built-in GitHub client, not the GitHub CLI"`), `K("GH_HOST")`/`K("GH_REPO")`: `"GH_HOST and a host in GH_REPO pick no host other than github.com here: name one with --hostname. A request to another host says so in one line on standard error."` | 本地只有包壳 `realGhPath` 的 bash `ghShim.ts`（直接透传 `GH_HOST` 给真实 `gh`），缺少内置 JS `gh api` 客户端及 `GH_HOST`/`GH_REPO` 拒绝非 `github.com`、stderr 提示逻辑。 |
| 162 | **GAP** | `src/skills/bundled/claudeApiContent.ts`, `src/skills/bundled/claude-api/shared/managed-agents-tools.md` | `@323064878..323076000`: `curl/managed-agents.md`, `{python,typescript,go,java,php,ruby}/managed-agents/README.md`, 15+ 个 `shared/managed-agents-*.md`；`@344188899..344215000`: Managed Agents 模板默认 `configs: [{name: web_search, enabled: false}, {name: web_fetch, enabled: false}]` | 本地 `claude-api` skill 仅含 `shared/managed-agents-tools.md` 与 `shared/managed-agents-self-hosted-sandboxes.md`，缺少各语言 `managed-agents` 示例文件及模板，且 `managed-agents-tools.md:82-85` 仍使用 `always_allow`/`always_ask` 而非 `auto`。 |
| 163 | **GAP** | `src/utils/teleport.tsx` (`L1315`, `L1878`), `src/cli/cloudSession.ts`, `src/bridge/sessionIdCompat.ts` (`toCompatSessionId`) | `@291041000` (`teleportToRemote`): `Oo=zhe(e.environmentId?e.environmentId:Pn.id)`, `fo=...\|\|Oo&&await QYr()?"v1alpha2":"v1"` → `iJs("v1alpha2",...)` 走 `POST /v1/code/sessions` (`EFr`)；`@300455441`/`@300641569`: 打印/JSON 输出调用 `lct(ve.id)` 将 `cse_...` 转为 `session_...` | 本地 `src/utils/teleport.tsx` 创建云端会话时（含 `options.environmentId`）仍硬编码 `POST /v1/sessions`，缺少 `ccpool_` 走 `v1alpha2` (`POST /v1/code/sessions`) 及创建输出 `lct()` 转回 `session_...` 的路径。 |
| 164 | **N/A** | — | `[VSCode]` screen reader `"Message queued."`（SEA 0 hits） | VSCode 扩展端无障碍朗读提示，不适用 CLI。 |
| 165 | **N/A** | — | `[VSCode]` Manage plugins dialog install/update command（VSCode UI） | VSCode 扩展插件管理弹窗，不适用 CLI。 |
| 166 | **N/A** | — | `[VSCode]` blank chat keeping background Claude process（VSCode webview/host） | VSCode 扩展聊天标签生命周期管理，不适用 CLI。 |
| 167 | **N/A** | — | `[VSCode]` settings dialogs blaming timeout（VSCode UI） | VSCode 扩展设置弹窗错误处理，不适用 CLI。 |
| 168 | **N/A** | — | `[VSCode]` branch switch dialog uncommitted changes check（VSCode UI） | VSCode 扩展切分支弹窗逻辑，不适用 CLI。 |
| 169 | **N/A** | — | `[VSCode]` permission prompt focus behind open dialog（VSCode UI） | VSCode 扩展前端弹窗焦点控制，不适用 CLI。 |
| 170 | **N/A** | — | `[VSCode]` sign-in / new sessions clear reason when Claude Code cannot start（VSCode extension host） | VSCode 扩展拉起进程失败提示，不适用 CLI。 |
| 171 | **N/A** | — | `[VSCode]` agent map nested sub-agent `"Tool calls (0)"`（VSCode UI） | VSCode 扩展 Agent Map 视图渲染，不适用 CLI。 |
| 172 | **N/A** | — | `[VSCode]` Continue After Reload（SEA 0 hits） | VSCode 扩展重启恢复机制，不适用 CLI。 |
| 173 | **N/A** | — | `[VSCode]` file pills hover showing path（VSCode UI） | VSCode 扩展消息内文件胶囊悬停提示，不适用 CLI。 |
| 174 | **N/A** | — | `[VSCode]` `Show Message Timestamps` setting（SEA 0 hits） | VSCode 扩展消息时间戳显示设置，不适用 CLI。 |
| 175 | **PARTIAL** | `src/cli/print.ts` (`L4297-4309`, `L5505-5510`), `src/query/stopHooks.ts` (`L268-271`), `src/services/PromptSuggestion/promptSuggestion.ts` (`L37-65`), `src/utils/residualFinalEnvGates.ts` (`L2192`) | `@298675596`: `AMt()` 读取 `i.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION` 与 `promptSuggestionEnabled` 设置；`@300457262`: `promptSuggestionEnabled: r.promptSuggestions && AMt()`；`@310715553`: `initialize` 中 `if (x.promptSuggestions && AMt())`；`@310234554`: `afterResult` 检查 `i.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION===!1` | 本地 `print.ts:4304`、`stopHooks.ts:271` 和 `promptSuggestion.ts:44` 已检查 `resolvePromptSuggestionEnvOverride() === false`，但 `print.ts:5505` 的 `initialize` 控制请求仍无条件 `setAppState(... promptSuggestionEnabled: true)`，缺少官方 `AMt()` 门控。 |
| 176 | **N/A** | — | `[Cloud sessions]` working indicator spinning after reply（SEA `"working indicator"` 0 hits） | claude.ai Cloud sessions 前端/服务端状态指示器，不适用本地 CLI。 |
| 177 | **N/A** | — | `[Cloud sessions]` History `"No runs yet"` after `"Run now"`（SEA `"No runs yet"` / `"Run now"` 0 hits） | claude.ai Routines 页面历史记录 UI，不适用 CLI。 |
| 178 | **N/A** | — | `[Cloud sessions]` unarchived cloud session looking still working（cloud session 状态展示） | claude.ai Web 端/服务端会话状态展示问题，不适用 CLI。 |
| 179 | **N/A** | — | `[Remote Control]` computer appearing in Remote Control menu of a new session `"within seconds"`（SEA `"Remote Control menu"` / `"within seconds"` 0 hits） | claude.ai 新建会话的 Remote Control 设备菜单刷新延迟（服务端/Web 端），CLI 侧启动即注册。 |
| 180 | **N/A** | — | `[Claude Tag]` Slack `!fast` / `!fast off`（SEA `"!fast off"` 0 hits） | Claude Tag (Claude in Slack) Slack 机器人指令，不适用 CLI。 |
| 181 | **N/A** | — | `[Claude Tag]` custom connection `"Path prefixes"` in access bundle（SEA `"Path prefixes"` 0 hits） | Claude Tag 管理后台 Access bundle 配置，不适用 CLI。 |
| 182 | **N/A** | — | `[Claude Tag]` `"Claude Tag Admin"` Memory tab `"Couldn't load memory files"`（SEA 0 hits） | Claude Tag Web Activity 页面权限修复，不适用 CLI。 |
| 183 | **N/A** | — | `[Claude Tag]` workspace guest Confirm on Slack settings card | Claude Tag Slack 交互卡片权限，不适用 CLI。 |
| 184 | **N/A** | — | `[Claude Tag]` scheduled routines in Slack channels default model | Claude Tag Slack 频道定时任务服务，不适用 CLI。 |
| 185 | **N/A** | — | `[Claude Tag]` GitHub repos in access bundle by channel-name rule | Claude Tag Slack 频道访问规则服务，不适用 CLI。 |
| 186 | **N/A** | — | `[Claude Tag]` DM notice when Claude plan usage limit reached | Claude Tag Slack 私信配额通知，不适用 CLI。 |
| 187 | **N/A** | — | `[Claude Tag]` earlier Claude in Slack app error reply | Claude Tag Slack 应用错误回复，不适用 CLI。 |
| 188 | **N/A** | — | `[Claude Tag]` channel instructions 8,192 characters limit + Configure page count | Claude Tag Web Configure 页面字数限制，不适用 CLI。 |
| 189 | **N/A** | — | `[Code Review]` blocking review comments `"nit"` label | GitHub Code Review 云端服务评论标签，不适用 CLI。 |
| 190 | **N/A** | — | `[Code Review]` tips to comment `"@claude review"` on fork/Manual-mode PRs（SEA `"@claude review"` 0 hits） | GitHub Code Review 云端服务 PR 提示逻辑，不适用 CLI。 |
