# scan 251-c — bullets #37–#54

> 扫员结论，**不进桶**。SEA 未下，不升 HAVE。来源：[Bullets 37–54](d0de93b6-e532-4aa3-aff7-6cf770aa9c42)。

| # | Official point | Verdict | Evidence |
|---|----------------|---------|----------|
| 37 | `mcp add --header` / `add-json` help names wrong transports | ABSENT | `src/commands/mcp/addCommand.ts` (`--header`: “Set WebSocket headers”); `main.tsx` / `cliCommandGraph.ts` (`add-json`: “stdio or SSE” only) |
| 38 | Ultrareview stops early when cloud session fails to start | UNCLEAR | create fail immediate in `reviewRemote.ts` (`teleportToRemote`); still 30 min in `RemoteAgentTask.tsx` (`REMOTE_REVIEW_TIMEOUT_MS`) |
| 39 | Bash no longer auto-approves integer arithmetic assignments | ABSENT | no `OPTIND` / integer-assignment gate in `BashTool/` or `readOnlyCommandValidation.ts` |
| 40 | Background sessions keep Vertex/Bedrock gateway env | UNCLEAR | `bgHostManagedEnv.ts` (`inheritParentEndpointEnv`, `BG_SKIP_AUTH_KEYS`); `bgHostManagedEnv.247.test.ts` — `tl()` does not copy `CLAUDE_CODE_SKIP_*` |
| 41 | `--bg --model fable` on Max does not spuriously ask usage credits | ABSENT | no bg+fable credits coupling in `src/daemon/`; `fableConsent.ts` / `accountCreditLatches` only |
| 42 | Auto-mode default offer suppressed in unattended / teammate panes | ABSENT | `shouldShowAutoDefaultNudge.ts`; `REPL.tsx` `maybeRequestAutoDefaultNudge` — no unattended gate |
| 43 | Managed-settings approval does not reappear after re-login when unchanged | LOCAL | `orgConsent.ts`; `securityCheck.tsx` (`hasDangerousSettingsChangedAgainstBaseline`); `ManagedSettingsSecurityDialog.tsx` |
| 44 | Disabled `/bug` / `/share` must not say `/feedback` is disabled | ABSENT | `feedbackDrafts/gates.ts` (`DISABLE_BUG_COMMAND` reason still “/feedback has been disabled”) |
| 45 | Cloud GitHub setup advice after transient failure → retry | N/A-CANDIDATE | `teleport.tsx` (`github_preflight_*`); no transient-retry copy |
| 46 | Less CPU from fewer redundant UI re-renders | UNCLEAR | `REPL.tsx` isolated tick; `Messages.tsx` `React.memo` — no 251 marker |
| 47 | Native binary ~5 MB smaller | N/A-CANDIDATE | install size, not a runtime feature |
| 48 | Cloud bash proxy drop names host + reason | N/A-CANDIDATE | local only generic `ECONNRESET` |
| 49 | `/schedule` explains MCP cannot attach to cloud routines | ABSENT | `launchSchedule.tsx` / `triggersApi.js` — no MCP explanation |
| 50 | Subagent messages framed as worker inside this session | ABSENT | `messages.ts` peer framing only; no “worker inside this session” |
| 51 | Prompt placeholder “Message @name…” when viewing bg subagent/fork | UNCLEAR | `usePromptInputPlaceholder.ts` only via `viewedTeammate` (`getViewedTeammateTask`), not `local_agent` bg/fork |
| 52 | Sanitize MCP server names | LOCAL | `formatMcpServerLabel.ts` (`sanitizeLabelSegment`); `mcpConnectionIssue.ts`; `formatMcpServerLabel.246.test.ts` |
| 53 | Bedrock host-managed auth skips inference-profile discovery when model ID/ARN given | ABSENT | `modelStrings.ts` → `getBedrockInferenceProfiles()` always; `bedrock.ts` (`ListInferenceProfilesCommand`); no `isHostManagedProviderAuth` skip |
| 54 | Managed settings approval dialog lists only changed keys | ABSENT | `ManagedSettingsSecurityDialog.tsx` lists full `extractDangerousSettings`; skip-if-unchanged does not diff inside dialog |

**Strongest ABSENT:** #37 MCP help 传输名；#39 整数算术赋值仍自动放行；#42 auto-mode nudge 无无人值守门；#44 `/bug` 关闭仍说 `/feedback`；#53 Bedrock host-managed 仍等 inference profile；#54 审批框列全量危险键。
