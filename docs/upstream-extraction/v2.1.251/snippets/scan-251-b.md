# scan 251-b — bullets #19–#36

> 扫员结论，**不进桶**。SEA 未下，不升 HAVE。来源：[Bullets 19–36](1d6b8e31-0514-49ac-af6e-b8e12aaf2c2a)。

| # | Official point | Verdict | Evidence |
|---|----------------|---------|----------|
| 19 | Hide Opus 1M upsell when Opus already has 1M context | ABSENT | `src/utils/model/contextWindowUpgradeCheck.ts` (`getAvailableUpgrade`, `getUpgradeMessage`); consumers `TokenWarning.tsx`, `AssistantTextMessage.tsx`, `compact.ts` — no `has1mContext` / resolved-model 1M check |
| 20 | Gateway sessions must not treat stored Anthropic Console profile as active | LOCAL | `src/utils/anthropicProfile.ts` (`isProfileAuthActive`); `anthropicProfile.234.test.ts`; `withRetry.ts` (401 + `storedClaudeAiLogin`); `status.tsx` (gateway → `getGatewayAuth()` only) |
| 21 | Cloud: don’t tell Claude the model changed when host only sets initial model | N/A-CANDIDATE | no CLI equivalent; `src/cli/print.ts` breadcrumbs are interactive model-switch only |
| 22 | Remote Control: org policy disable → quiet notice, not failure | ABSENT | `src/bridge/initReplBridge.ts` (`onStateChange?.('failed', … policy)`); `useReplBridge.tsx` (`surfaceBridgeFailure` → “Remote Control failed”) |
| 23 | RC `/mcp reconnect`: real remedy vs withheld-detail | ABSENT | `src/commands/mcp/mcp.tsx`; `headlessMcpReconnect.ts` — no RC/withheld-remedy handling |
| 24 | stream-json assistant tool calls without message id merge/lose results | ABSENT | `src/cli/structuredIO.ts`; `src/cli/print.ts` — no merge-by-`message.id` |
| 25 | Don’t silently overwrite transcript when cwd move lands on same-id file | ABSENT | `sessionStorage.ts` (`relocateSessionTranscript`); `relocateSessionTranscript.218.test.ts` — no collision/adopt |
| 26 | BG sessions can edit files in git worktree they created | UNCLEAR | `worktree.ts` (`lockClaudeWorktree`); `bgIsolationContainment.ts` (`checkBgIsolationWriteBlock`) |
| 27 | BG sessions start with no plugin skills when marketplace refresh races | ABSENT | `plugins/refresh.ts` (`refreshActivePlugins`); `print.ts` (`refreshPluginState`) — no empty-skills guard |
| 28 | tmux over SSH: bg selection → tmux buffer, not OSC 52 | LOCAL | `packages/@ant/ink/src/core/termio/osc.ts` (`getClipboardPath`, `tmux-buffer`); `ScrollKeybindingHandler.tsx` |
| 29 | SDK/cloud MCP handshake ack lost → 70s timeout | ABSENT | `SdkControlTransport.ts`; `client.ts` (`setupSdkMcpClients`) — no 70s handshake timeout |
| 30 | Self-hosted runner: kill leftover Bash after force-stop | ABSENT | `gitPrepare.ts` (`killProcessTree` for git); `sessionHandler.ts` / `rootRunner.ts` — no Bash tree kill |
| 31 | `/usage-credits` org limit $0: ask admin, not “cap reached” | ABSENT | `extra-usage-core.ts` (`runExtraUsage`); mock `org-zero-credit-limit` only |
| 32 | `--worktree --tmux` GitLab MR fetches GitLab ref first | LOCAL | `worktree.ts` (`resolvePrFetchSpecs`); `worktree.prRef.233.test.ts` |
| 33 | Ctrl+G + `/dev/tty` editors in background sessions | ABSENT | `promptEditor.ts` (`stdio: 'inherit'`); no `/dev/tty` bg fix |
| 34 | Skip `additionalDirectories` entries with null byte | ABSENT | `settings/types.ts` (`z.array(z.string())`); no `\0` skip |
| 35 | MCP menu copy shortcut says how URL was copied | ABSENT | `MCPRemoteServerMenu.tsx` (“(Copied!)” only); contrast `ConsoleOAuthFlow.tsx` |
| 36 | Italic text in GNU screen / `TERM=screen` not highlighted blocks | ABSENT | `packages/@ant/ink/src/core/colorize.ts` (`chalk.italic`); no `TERM=screen` workaround |

**Strongest ABSENT:** #19 Opus 1M upsell；#29 SDK MCP 70s handshake；#24 stream-json 无 message id；#25 transcript 同 id 覆盖；#22 RC policy 仍报 failed。
