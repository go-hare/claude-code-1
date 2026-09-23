# scan 251-d — bullets #55–#71

> 扫员结论，**不进桶**。SEA 未下，不升 HAVE。来源：[Bullets 55–71](19863c52-3d1a-421e-bcf6-178077a2f09c)。

| # | one-line official point | verdict | evidence |
|---|-------------------------|---------|----------|
| 55 | Malformed tool-call retry drops broken output (incl. Bedrock/Vertex/Foundry) | UNCLEAR | Partial: `src/services/api/claude.ts` (`malformedFallbackBlockIndexes`, `tengu_rotunda_pennant_malformed`, `tengu_rotunda_pennant_sync_dropped`); `src/utils/refusalFallback.ts` (`materializeNonStreamingServerFallbackContent`). No Bedrock/Vertex/Foundry-specific retry-context drop; `malformed_tool_use_exhausted` only in `src/query/transitions.ts` / `src/engine/hostEngine.ts` with no handler in `src/query.ts` |
| 56 | `/radio` on Bedrock/Vertex/Foundry/telemetry-off | ABSENT | no hit for `/radio` or radio command in `src/commands*` / `src/commands.ts` (only UI `figures.radioOn/Off` in plugin pickers) |
| 57 | Claude in Chrome always uses CC permission checks (incl. telemetry off) | UNCLEAR | `src/dialog/permissionBrowser.ts` (`isClaudeInChromeInProductPermissions`, GB `tengu_cfc_in_product_permissions`, default false); `src/dialog/selectPermissionDialog.ts`; no telemetry-off-specific wiring found |
| 58 | `CLAUDE_CODE_SUBAGENT_MODEL` is default; agent/spawn model wins | ABSENT | `src/utils/model/agent.ts` (`getAgentModel` returns early on env before `toolSpecifiedModel`); tests in `src/utils/model/__tests__/agentFamilyStepDown.222.test.ts` omit env-vs-tool precedence |
| 59 | Commit trailer `Co-Authored-By: Claude Code` for non-Claude models | ABSENT | `src/utils/attribution.ts` (`defaultCommit` via `getRealModelName()`); `src/utils/attributionModel.ts` (provider model id only) |
| 60 | Seat Enterprise default model Opus 5 | ABSENT | `src/utils/model/model.ts` (`getDefaultMainLoopModelSetting`: Enterprise → Sonnet, not Opus 5) |
| 61 | `/effort` saves default effort per model | ABSENT | `src/utils/effort.ts` (`getInitialSettings().effortLevel`, `toPersistableEffort`); `src/commands/effort/effort.tsx` (single `effortLevel` persist); no per-model effort map |
| 62 | Analytics not off pre-login solely due to managed gateway force | ABSENT | `src/services/analytics/config.ts` (`isManagedGatewayAnalyticsOff` → `isAnalyticsDisabled()` with no sign-in gate); `src/services/analytics/__tests__/analyticsStartup.247.test.ts` |
| 63 | Footer PR badge uses GitHub API (not `gh pr view`) on 3P/telemetry-off | UNCLEAR | `src/utils/prStatusPoller.ts` (`fetchDirectPrStatus`, `resolveGithubAuthToken`, `isDirectApiEnabled` / `tengu_harbor_prism` default false); `src/hooks/usePrStatus.ts`; legacy `src/utils/ghPrStatus.ts` still `gh pr view` |
| 64 | Sandbox bash output files cannot be replaced by sandbox | LOCAL | `src/utils/task/diskOutput.ts` (`initTaskOutput`: `O_NOFOLLOW`, `O_CREAT`+`O_EXCL` / `'wx'`) |
| 65 | Plugin/LSP/auto-mode offers wait until prompt sent/cleared | LOCAL | `src/screens/REPL.tsx` (`getFocusedInputDialog`: `isPromptInputActive` suppresses LSP/plugin-hint dialogs; tip overlays also gated) |
| 66 | Managed sandbox-weakening settings require approval | UNCLEAR | Generic `src/dialog/specs/managedSettingsSecurity.ts` + `installManagedSettingsSxg`; no sandbox TLS/proxy/weaken-specific approval logic in `src/services/remoteManagedSettings/` |
| 67 | `ANTHROPIC_CUSTOM_HEADERS` credential headers need approval | ABSENT | `src/utils/managedEnvConstants.ts` (`ANTHROPIC_CUSTOM_HEADERS` in `SAFE_ENV_VARS`); `src/services/api/client.ts` (`getCustomHeaders`); no approval dialog for credential headers |
| 68 | Project `settings.json` `env` no longer sets config/tmp dirs | LOCAL | `CLAUDE_CONFIG_DIR` / `TMPDIR` / `CLAUDE_CODE_TMPDIR` not in `SAFE_ENV_VARS` (`src/utils/managedEnvConstants.ts`); project env via `isSafeManagedEnv` in `src/utils/managedEnv.ts` |
| 69 | Removed syntax highlighting for six rare languages | UNCLEAR | `src/utils/cliHighlight.ts` + full `highlight.js` import; no explicit removal of 1c/gml/isbl/mathematica/maxima/sqf in repo |
| 70 | [VSCode] Bedrock/Foundry/Vertex sign-in docs anchor | N/A-CANDIDATE | no VSCode extension UI source under `src/` or `packages/` |
| 71 | [VSCode] Remote Control banner → footer pill | N/A-CANDIDATE | no VSCode extension UI source under `src/` or `packages/` |

**Strongest ABSENT:** #56 `/radio`；#58 env 仍硬覆盖 spawn model；#59–#61 trailer / Enterprise Opus 5 / per-model effort；#62 gateway 预登录仍关 analytics；#67 `ANTHROPIC_CUSTOM_HEADERS` 无凭据审批。
