# scan 251-a — bullets #1–#18

> 扫员结论，**不进桶**。SEA 未下，不升 HAVE。来源：[Bullets 1–18](e10b8df0-94e6-4f8b-b88f-d6f5104619cb)。

| # | Official point | Verdict | Evidence |
|---|----------------|---------|----------|
| 1 | `PreModelSwitch` / `PostModelSwitch`; resume `SessionStart` gets staleness + re-cache cost | ABSENT | `src/entrypoints/sdk/coreSchemas.ts` `HOOK_EVENTS` — no model-switch events; `hooks.ts` `SessionStartHookInput` only `source`/`model` |
| 2 | Live stream foreground subagent tool calls to Remote Control | ABSENT | no foreground tool stream in `src/bridge/`; `useRemoteSession.ts` task_progress only |
| 3 | Spend limit bar on `/usage` + `rate_limits.spend_limit` | ABSENT | `statusLine.ts` `rate_limits` only `five_hour`/`seven_day`; `Usage.tsx` no spend_limit |
| 4 | Per-session prompt-cache line on `/cost` + `prompt_cache` status field | UNCLEAR | `cacheStats.ts` / `StatusLine.tsx` `CachePill`; `cost.ts` `formatTotalCost()` only; no `prompt_cache` on `StatusLineCommandInput` |
| 5 | `attach`/`logs`/`stop`/`respawn`/`rm` on `--help`; `--resume` names `claude attach` | UNCLEAR | `cli.tsx` attach/logs/rm redirect to daemon; `bg/helpers.ts` `claude attach`; `daemon/main.ts` `stop`; no top-level `respawn` |
| 6 | Symlink swap TOCTOU after permission on Read/Write/Edit | ABSENT | `readFileInRange.ts` no `O_NOFOLLOW`; `symlinkWriteGuard.ts` not wired into file tools |
| 7 | Marketplace plugin command paths cannot escape plugin dir | ABSENT | `pluginLoader.ts` `join` + `pathExists` only; `validatePathWithinPlugin` only in `lspPluginIntegration.ts` |
| 8 | Block project settings enabling beta tracing / raw API body; OTLP bypass | UNCLEAR | project env limited to `SAFE_ENV_VARS`; `initializeBetaTracing` uses `BETA_TRACING_ENDPOINT` separate from managed OTLP — no raw-body gate |
| 9 | Workflow `scriptPath` not read/quoted before permission | ABSENT | `WorkflowTool.ts` `resolveScriptSource` → `readFile` in validation before `call()` permission |
| 10 | Grep/Glob apply `Read(...)` deny through symlinked search path | ABSENT | Glob/Grep `checkReadPermissionForTool` on input path only; ripgrep over `searchDir` |
| 11 | Fix stuck “text content blocks must be non-empty” after thinking-only | LOCAL | `messages.ts` `normalizeMessagesForAPI`; `query.ts` thinking-only nudge retry |
| 12 | Fresh install starts in auto when account startup default is auto | UNCLEAR | `autoModeHarborWillow.ts`; `permissionSetup.ts` `defaultMode` — no account startup-default field |
| 13 | Opus effort xhigh/max with thinking off → send `high` | ABSENT | `claude.ts` `isTopEffortWithThinkingOff` throws; `effortThinkingGuard.ts` |
| 14 | `SendMessage` to Desktop-delivered session id routes via Desktop | N/A-CANDIDATE | `SendMessageTool.ts` “Do not invent Desktop handoff” |
| 15 | Subagent progress ticks replace predecessor | LOCAL | `REPL.tsx` replace ephemeral tick for same `parentToolUseID`; `messages.test.ts` |
| 16 | Teammate final answer in idle notification | UNCLEAR | `teammateInit.ts` `createIdleNotification` + `getLastPeerDmSummary` (last DM, not full answer) |
| 17 | Background subagent reply: `from` is address not agent type | ABSENT | no unnamed sibling/parent `from` fix in AgentTool / SendMessageTool |
| 18 | Mid-session `disableAutoMode` moves running auto session to default | ABSENT | `isAutoModeDisabledBySettings` at setup only; `applySettingsChange.ts` no mid-session downgrade |

**Strongest ABSENT:** #1 model-switch hooks；#2 RC 前景 subagent 流；#3 spend limit；#13 thinking off 仍抛错不降 `high`；#6/#7/#17 symlink TOCTOU、plugin 路径穿越、subagent `from` 地址。
