# Claude Code (go-hare)

[![GitHub Stars](https://img.shields.io/github/stars/go-hare/claude-code-1?style=flat-square&logo=github&color=yellow)](https://github.com/go-hare/claude-code-1/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/go-hare/claude-code-1?style=flat-square&color=orange)](https://github.com/go-hare/claude-code-1/issues)
[![Last Commit](https://img.shields.io/github/last-commit/go-hare/claude-code-1?style=flat-square&color=blue)](https://github.com/go-hare/claude-code-1/commits/main)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh/)
[![npm](https://img.shields.io/npm/v/@go-hare/claude-code?style=flat-square&logo=npm)](https://www.npmjs.com/package/@go-hare/claude-code)

[中文 README](./README.md)

A **source restoration / engineering rebuild** of Anthropic’s official Claude Code CLI. The goal is to keep the Claude Code terminal experience while adding multi-provider models, self-hosted Remote Control, ACP, daemon / background sessions, MCP, plugins, and local automation.

> This is **not** an Anthropic product. Claude Code trademarks and rights belong to [Anthropic](https://www.anthropic.com/). This project is for learning and research.

| Capability | Notes |
| ---------- | ----- |
| **Multi-provider** | Configure Anthropic / OpenAI / Gemini / Grok-compatible endpoints via `/login` |
| **Remote Control** | Self-hosted RCS + Web UI; `claude remote-control` / bridge |
| **ACP** | Agent Client Protocol for IDE / proxy hosts |
| **Agents / Daemon** | `claude agents` dashboard, daemon jobs, background session resume / fork |
| **Fullscreen** | densable-aligned wheel, Jump-to-bottom, alt-screen behavior |
| **Poor Mode** | `/poor` skips memory extract / suggestions to cut token spend |
| **KAIROS / Buddy** | Persistent assistant and terminal buddy (feature-gated) |
| **Computer Use / Chrome** | Screenshot + input, Chrome MCP (platform coverage varies) |
| **Artifacts** | HTML upload hosting (standalone Cloudflare Worker package) |
| **Voice** | Speech input (including Doubao ASR path) |
| **Web Search** | Built-in search tool |
| **Langfuse** | Optional agent-loop observability |

Some capabilities are **feature-flagged** (see below). Analytics / GrowthBook / Sentry are **stub / empty implementations** — do not treat them as production enterprise integrations.

---

## Positioning

This is a **CLI-first** Claude Code–compatible runtime:

- Interactive host: `src/screens/REPL.tsx` + `src/main.tsx` / `src/entrypoints/cli.tsx`
- Query loop: `src/query.ts` / `src/QueryEngine.ts`
- Tools: `packages/builtin-tools` (exported as `@claude-code/builtin-tools`)
- Remote / daemon: `src/bridge/`, `src/daemon/`, `packages/remote-control-server/`
- ACP: `src/services/acp/`, `packages/acp-link/`

There is **no** package-level Agent Core split at `src/core`, `src/hosts`, or `src/runtime`, and no `createAgent` / `claude/core` export. Older docs that claim those paths are outdated.

Recent work closed **densable 2.1.211 → … → 2.1.222 → 2.1.228** product alignment (222 worktree/streaming/RC + **228 layout / Windows git / SHR / UDS / skills / Vertex / Write gate**, 18 rows). **Published npm version is whatever `package.json` says** (currently **2.7.38**; trust `package.json` / npm) and may not match git tags.

#### densable 2.1.228 alignment (2.7.37)

Source of truth: `docs/upstream-extraction/v2.1.228/official-228-checklist.md` (**HAVE 18 / GAP 0**), `changelog-2.1.228.md`, `cross-pack-residuals.md`. Stacked on **2.1.227** (223–227 already on git; this npm line closes through 228).

| Surface | Landed 1:1 | Intentionally out of scope |
| ------- | ---------- | -------------------------- |
| **Ink / input** | layout fault immediate re-layout + reportLayoutFault*; **kTd** text whole-token SGR/X10 re-ESC only; incomplete CSI in tokenizer buffer / NORMAL_TIMEOUT flush | no pendingSgr/absorbMm/2-param KE empty invent; KE progressive sinks = local delta |
| **Windows / SHR** | `uio` parent-of-Git where filter; checkout hook skip on non-push + warn; follow-up hold + `countNonMonitorTasks`; emit→clear densable order | no clear-first / re-arm idle invent |
| **UDS / LAN / RC** | `key_publish_failed` hard-fail start + `CLAUDE_CODE_MESSAGING_TOKEN`; LAN TCP pre-auth + timing-safe compare; RC reattach owner meta / noHistoryBackfill; left-arrow stash bridge | no dual UDS token / pairing invent |
| **skills / tools / cloud** | syncedSkills harden core (shadow/sanitize/no `!`/`@`); Write/Edit Jqy/MCt + l8t `errorCode:13` (validateInput+call); Vertex fail-fast + Bedrock GKd wiring; St mid-turn attachments | #12 **core only** (no full claude.ai ingest); #3 `/tui` Bxa `--model` pin only |
| **other** | cleanup keeps memory; plugin symlink not orphaned; marketplace ssn whole-entry; title ◐/◑; auto-mode drop expensive sentence; cross-session from-name; local PR subscription store | **223 #3 teleport** invent-ban; **221 #12** DEP-HAVE (srt) |
| **Feature defaults** | **UDS_INBOX / LAN_PIPES / TEAMMEM / KAIROS periphery** DEFAULT_BUILD **ON** | **ULTRAPLAN** still OFF; `tengu_ccr_bridge` not default true |

#### densable 2.1.222 alignment (2.7.36, included)

Source of truth: `docs/upstream-extraction/v2.1.222/official-222-checklist.md` (**HAVE 21 / GAP 0**), `changelog-2.1.222.md`. Stacked on **2.1.221**. **2.7.36** is a 222-line hotfix for the empty streaming `●` after collapsed tool groups (`hasContentAfter` drops invent `||streamingPreview`; whitespace / strip-empty does not paint XEl).

| Surface | Landed 1:1 | Intentionally out of scope |
| ------- | ---------- | -------------------------- |
| **worktree / permissions** | every-session worktree isolation fences (file edits + Bash); PreToolUse auto-allow cannot bypass `requireCanUseTool`; SendMessage auto-mode classifier; `disable-model-invocation` asks user to run skill | — |
| **streaming UI / reliability** | UNf/BNf/WNf/Qci streaming store; salvage survives pH.clear; close-after-complete no false mid-response; gateway keep-alive ping; preflight proxy + 10s timeout; file watcher error teardown; SR EOL delete; **2.7.36: empty streaming `●` / false past-tense “Ran N…”** | — |
| **RC / settings / host** | `remoteControlAtStartup`: project/local cannot enable (can disable); `flagSettings` + `projectSettingsAliasesUserSettings`; host model overlay beats stale managed-settings | — |
| **tools / cost / git** | MCP usage only when tools truly consumed; SendMessage summary truncate; tool-gone still rendered; post-push PR link; raw git diff `--no-textconv`/`--no-ext-diff`; agent family alias step-down | — |
| **Feature defaults** | **ULTRAPLAN** product default OFF (`FEATURE_ULTRAPLAN=1` revives residual) | **UDS_INBOX / LAN_PIPES / TEAMMEM** ON since 2026-08-12; **KAIROS periphery** channels/push/webhook ON; **ULTRAPLAN** still OFF |

#### densable 2.1.219–2.1.221 alignment (2.7.37, included)

Sources of truth:
- `docs/upstream-extraction/v2.1.219/official-219-checklist.md` (**HAVE 24 / GAP 0**)
- `docs/upstream-extraction/v2.1.220/official-220-checklist.md` (public 1-liner N/A + SEA residual **HAVE**)
- `docs/upstream-extraction/v2.1.221/official-221-checklist.md` (**HAVE 35 / GAP 2 / N/A 2**)

Stacked on **2.1.218**. **Historical snapshot** in older tables may still say GAP for #10/#12 — **current** status in checklist / `cross-pack-residuals.md`: **#10 HAVE** (API-request null-proto/hasOwn); **#12 DEP-HAVE** (sandbox-runtime, not CLI invent). #1 VSCode Focus / #38 gateway model 400 remain **N/A**.

| Surface | Landed 1:1 | Intentionally out of scope |
| ------- | ---------- | -------------------------- |
| **2.1.219 models / caps** | Opus 5 catalog (EHl/ON) + 1M picker “Opus (1M context)”; nest depth default 3 (hazel_trellis); `workflowSizeGuideline`; stream-json nested `--forward-subagent-text`; Fable credits stale cache | — |
| **2.1.219 permissions / hooks / UX** | `sandbox.network.strictAllowlist`; `DirectoryAdded` hook; init `mcp_server_errors`; GIT_BASH basename validate; Vim left-on-empty → agent view; SR suffix append; RC endpoint naming; MCP policy `${VAR}` | — |
| **2.1.220 residual** | `isEntitlementOverlayUnavailable` / entitlement deny-set; `entitlement_blind` telemetry; blind opus-5 → opus-4-8 substitute | Official public has no per-bullet product list (N/A) |
| **2.1.221 security / permissions** | sandbox credential `mode:"mask"`; zsh `[[ ]]` unquoted `&`; **PowerShell quote-path pWo fail-closed ask**; Bash U5e/cle full `bareAssignmentNames` (for danger set / declaration flags / Pws·uVu) + ZRu reads bare only; **#10 constructor API-request HAVE** | **#12 large-upload TLS** = **DEP-HAVE** (srt); do not invent CLI handler |
| **2.1.221 session / plugins / UI** | prompt-audit; session title sanitize; Vim yank share / undo-to-empty; plugin install catalog refresh + reload clears notice; `/status` session kind; Stats cache breakdown; ultrareview no-branches; bg commit/draft-PR policy; Vertex ToolSearch native wire | **#1 VSCode Focus** N/A; **#38 gateway** N/A |
| **Feature defaults** | Build default feature set in `build.ts` | **UDS_INBOX / LAN_PIPES / TEAMMEM** ON since 2026-08-12; **KAIROS periphery** channels/push/webhook ON; **ULTRAPLAN** still OFF |

#### densable 2.1.218 alignment (2.7.33, included)

Source of truth: `docs/upstream-extraction/v2.1.218/official-218-checklist.md` (**HAVE 35 / N/A 1 / GAP 0**), `changelog-2.1.218.md`. Stacked on **2.1.217**. Do **not** claim “36/36 solid HAVE” — official **#9 gateway spend metering** is **N/A** (go-hare does not ship a gateway); CLI cousin `application-inference-profile` cost resolve is a separate HAVE.

| Surface | Landed 1:1 | Intentionally out of scope |
| ------- | ---------- | -------------------------- |
| **code-review / ultrareview** | `/code-review` bg subagent + stacked slash; `/code-review ultra` non-interactive cloud; `/ultrareview` descriptive args + invalid-arg feedback | — |
| **a11y / input** | SR delete announce; VoiceOver trailing space; plugin/settings `declareCursor`; multi-line paste Ctrl+J→newline; left-arrow confirm + AgentView Esc return | — |
| **Permissions / auto-mode / sandbox** | dangerous-rm/`&`/Win path circuitBreaker; plan+auto RO Bash→classifier; sandbox IDE commands fail-closed; agent frontmatter hooks need workspace trust | — |
| **Session / engine** | Host teardown phantom turn + sticky permissionLayers; suppress false interrupt; fork `logical_parent_uuid`; prompt history race; overflow retry + Ctrl+B shell caps | — |
| **Cloud / remote / IDE** | Bedrock setup assume-role/partition/proxy; CCR closed-gate stops heartbeat; IDE selection mid-emoji + sibling_context_error; PR link flush 2s | — |
| **Frontmatter / skills / trust** | agent name ban `:`; fork skill default background; bool yes/no/on/off/1/0; plugin `--config KEY=VALUE`; `/deep-research` manual-only; trust shows repository root + RC multi-env Add-server | **#9 gateway metering** N/A |
| **Ink / Agent Views (ship hardening)** | skipSyncMarkers; unmount skips paused previous-output; no empty-frame skip; Esc = densable JH done + O7 `suppressResumeHint` (no attach-origin black screen) | UDS/LAN/TEAMMEM default OFF |

#### densable 2.1.217 alignment (2.7.32, included)

Source of truth: `docs/upstream-extraction/v2.1.217/official-217-checklist.md` (**HAVE 20 / GAP 0**), `changelog-2.1.217.md`. Stacked on **2.1.216**.

| Surface | Landed 1:1 | Intentionally out of scope |
| ------- | ---------- | -------------------------- |
| **Caps / budget** | concurrent subagents default 20; nested depth default 1 (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` / hazel_trellis); `--max-budget-usd` halts bg subagents | — |
| **paths brace** | frontmatter brace budget (Xug=1000 / Jug=4MB); over budget → unexpanded + warn | — |
| **Hyperlink / tips / login** | `FORCE_HYPERLINK`; frontend-design tip lifetime ≤3; login-expiry warning 3 days | — |
| **emoji** | shortcode typeahead + `emojiCompletionEnabled` | — |
| **bg isolation #5** | symlink cwd canonicalize (`eq`/`N6g`/`XNe`/`hsr`); Shell `context_lost`→`worktree_gone`→VRu→bash ZRu; `bareAssignmentNames`+YPg/FJi/tLg; Write e7 / Edit·Notebook e12 | **stricter parse failure** (`parse-unavailable` fail-closed vs densable empty simple) |
| **Reliability** | transcript writer ENOSPC; MCP truncate no full rehydrate; Opus 4.8 Bedrock 1M; SR startup quiet; managed OTEL endpoint supremacy; malformed attachment resume; attach footer gap; Win absolute taskkill | UDS/LAN/TEAMMEM default OFF |

#### densable 2.1.216 alignment (2.7.31, included)

Source of truth: `docs/upstream-extraction/v2.1.216/official-216-checklist.md` (**HAVE 38 / N/A 1 / GAP 0**), `pack-report.md`, batch extracts. Stacked on **2.1.214/215**.

| Surface | Landed 1:1 | Intentionally out of scope |
| ------- | ---------- | -------------------------- |
| **Sandbox** | `sandbox.filesystem.disabled` (skip FS isolation, keep network egress); first-class credentials | — |
| **Long session / normalize** | quadratic message-normalize fix (Map + cursor); `/context` over-limit warning; failed compact as error | — |
| **Auth / auto mode** | OAuth 401 sideQuery retry; AskUser free-text neutral wording; Chrome missing-scope 403 loop; MCP re-auth without early revoke | — |
| **worktree / bg** | git isolation (block `git -C`/`GIT_DIR` into shared checkout); foreign-repo resume; deletable no-git worktree; daemon `stop --any` no mis-kill; resume agent identity; bg startup cancel immune to interrupt | — |
| **Permissions / Shell / PS** | list/negation redirect; Win network-path RO prompt; non-ASCII word boundaries; PS invisible Unicode; stronger git/gh args | — |
| **UI / session UX** | @-mention/hooks/vim paste/statusline/resume-picker; Esc-Esc rewind; agent list Ctrl+X delete; GUI editor handoff; fullscreen dialog/config/footer; skill menu hot refresh; plugin skill prefix; one-line fork confirm | — |
| **Other** | `/rewind` no symlink/hardlink; ultrareview size/empty-diff; spend-limit reason; telemetry user_abort; needs-input park; dataviz palette; cloud interrupted-turn re-run | **#39 VSCode RTL** N/A; UDS/LAN/TEAMMEM default OFF |

#### densable 2.1.215 alignment (included in 2.7.31)

Source of truth: `docs/upstream-extraction/v2.1.215/official-215-checklist.md` (**HAVE 2 / N/A 1 / GAP 0**).

| Surface | Landed 1:1 | Intentionally out of scope |
| ------- | ---------- | -------------------------- |
| **Skills policy** | `/verify`, `/code-review`: `disableModelInvocation: true` + user `/` still works | Do **not** disable `/simplify` (still model-invocable); verification-agent copy N/A |

#### densable 2.1.214 alignment (2.7.30, included)

Source of truth: `docs/upstream-extraction/v2.1.214/official-214-checklist.md` (**HAVE 47 / GAP 0**), batch extracts. Stacked on the **2.1.212** closeout: safety valves, EndConversation, PS/Bash, bg daemon, RC ready-push, etc.

| Surface | Landed 1:1 | Intentionally out of scope |
| ------- | ---------- | -------------------------- |
| **Permissions / Bash / PS** | single-segment `dir/` allow cwd-only; PS 5.1 bypass; fd redirect fail-closed; >10k prompt; zsh `[[ ]]`; help/man; docker daemon-redirect; PS stdin/encoding/where·fc·diff | — |
| **Session / tools** | EndConversation; long-tool progress heartbeat; stream cost double-count fix; advisor network stall; hooks exit 2 priority | — |
| **GrowthBook / OAuth** | null/malformed payload no crash/no cache wipe; OAuth rotation refreshes flags | — |
| **bg daemon** | yield keeps successor control socket; idle retire; `claude rm`/AgentView deleteJob; non-git force delete; transcript directory false hits | — |
| **RC ready-push** | explicit RC + GB nudge only; reject outbound/reattach/bg/agentId; impression counters; `onInteraction` activity latch | No further KAIROS product surface |
| **OTel / MCP / other** | message.uuid / client_request_id / tool_source; OTEL content max; out-of-context trace; MCP list_changed keep-previous; flag settings plugins; ultrareview empty-tree; SessionStart `source:"fork"`; etc. | — |
| **Feature defaults** | Build default feature set in `build.ts` | **UDS_INBOX / LAN_PIPES / TEAMMEM / KAIROS periphery** ON since 2026-08-12; **ULTRAPLAN** still OFF |

#### densable 2.1.212 alignment (2.7.29, included)

Source of truth: `docs/upstream-extraction/v2.1.212/official-212-checklist.md` (**HAVE 44 + N/A 1, 0 GAP**), `pack-report.md` closeout, `residual-qre-jes-2026-08-06.md`.

| Surface | Landed 1:1 | Intentionally out of scope |
| ------- | ---------- | -------------------------- |
| **Session safety valves** | WebSearch / subagent default 200 + env; `/clear` resets; MCP long-call auto-background (default 2min / env) | — |
| **`/fork` · `/subtask`** | `/fork` = background session copy + keepParent; in-session full-context worker = `/subtask` | Do not keep legacy in-session path named `/fork` |
| **Agents UX** | agent-view `/resume` picker → bg; reopen stopped; cold attach transcript; footer `N done`; **Needs input** | — |
| **`claude auto-mode reset`** | confirm prompt + `--yes` | — |
| **Reliability / UX batch** | plan bash writes, worktree symlink guard, hook `continue:false`, print SIGTERM 143, Win PS7 bg, shell `!` paths, bare `/btw`, SendMessage preview, Web 529, mid-conv cache, etc. (see checklist) | No **2.1.210** collapsed-tool live elapsed (adjacent) |
| **ultrareview / teleport** | Qre create stays `POST /v1/sessions`; OTe/KLc/H8/F1g/nts on `/v1/code/sessions`; o9t token, payload wrap, archive=kill | Do not invent main-CLI `--project/--ref/--on-branch` flags densable never registers (rts middle layer already ready) |
| **Feature defaults** | Build default feature set in `build.ts` | **UDS_INBOX / LAN_PIPES / TEAMMEM / KAIROS periphery** ON since 2026-08-12; **ULTRAPLAN** still OFF |

### Recent updates (2.7.5 → 2.7.38)

| Version | Highlights |
| ------- | ---------- |
| **2.7.38** | **Grok 4.6 effort catalog**: add a `grok-4.6` row via longest-substring model-id match (not a vendor heuristic); same 3-tier ladder as 4.5 (`low \| medium \| high`, default `high`, no max/xhigh); `/effort max`/`xhigh` clamp to `high`. Official 4.6 reasoning page is unpublished — inherit [xAI 4.5 reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning). Do not remap opus→`grok-4.20-reasoning`; no bare `grok-4` row (would swallow `grok-4.20-multi-agent` xhigh). |
| **2.7.37** | **densable 2.1.228 full 1:1 (18/18 HAVE)** + 223–227 included: Ink layout recover; kTd whole-token re-ESC + incomplete buffer; Windows `uio`; SHR checkout skip + follow-up hold; UDS `key_publish` fail-closed + LAN TCP auth; RC reattach owner / left-arrow; syncedSkills harden core; Write/Edit Jqy/MCt+l8t; Vertex fail-fast + Bedrock GKd; St mid-turn; cross-session from-name; cleanup memory / plugin symlink / marketplace ssn; `/tui` model pin; title ◐/◑; auto-mode drop expensive; DEFAULT_BUILD **UDS/LAN/TEAMMEM/KAIROS periphery ON**; 221 #10 null-proto + createSdkMcpServer. Residuals: `cross-pack-residuals.md` (teleport invent-ban). |
| **2.7.36** | **Empty streaming `●` hotfix (densable 222 residual)**: `hasContentAfter` matches densable `y\|\|aem` (drop invent `\|\|streamingPreview`); whitespace / strip-empty does not paint XEl; `Qci` trim-empty clears `STREAM_FLAG_DISPLAYED`. Stops false past-tense “Ran N…” after collapsed tools + lone bullet before Cooking. |
| **2.7.35** | **densable 2.1.222 full 1:1 (21/21 HAVE)** + 219–221 included: every-session worktree isolation; streaming UNf/WNf/Qci + salvage clear contract; RC `remoteControlAtStartup` source limits (flag/aliases); host model overlay; ULTRAPLAN product OFF; preflight proxy timeout; MCP usage attribution; SendMessage classifier/truncate; tool-gone display; post-push PR link; raw git diff; agent family step-down; SR EOL delete; file watcher teardown; etc. Includes 219 **24/24** / 220 residual / 221 (ship-time snapshot **HAVE 35 / GAP 2 / N/A 2**; **later** #10→HAVE, #12→DEP-HAVE — see checklist / cross-pack-residuals). UDS/LAN/TEAMMEM were OFF at ship (later ON). |
| **2.7.33** | **densable 2.1.218 full 1:1 (35 HAVE / 1 N/A / 0 GAP)**: code-review bg + ultra cloud; ultrareview descriptive/invalid args; SR a11y / Ctrl+J / left-arrow confirm / AgentView Esc; Host teardown + permissionLayers; auto-mode/sandbox IDE; fork lineage; Bedrock wizard; CCR heartbeat; frontmatter bool/`--config`/ban `:`; `/deep-research` manual-only; RC multi-env trust. **#9 gateway metering N/A**. Ship hardening: Ink skipSyncMarkers/unmount/alt-screen; Agent Views Esc no attach-origin black screen + O7 exit. UDS/LAN/TEAMMEM default OFF. |
| **2.7.32** | **densable 2.1.217 full 1:1 (20/20 HAVE)**: concurrent subagents 20 / nest depth 1; brace budget; `FORCE_HYPERLINK`; emoji shortcode typeahead; tip lifetime 3; login 3d; transcript ENOSPC; MCP truncate; Opus 4.8 Bedrock 1M; SR startup quiet; managed OTEL; malformed attachment; attach footer gap; Win taskkill; bg isolation `eq`/`N6g`/`ZRu` bare+YPg (ZRu Shell.exec-only). **Intentionally stricter**: parse-unavailable fail-closed. UDS/LAN/TEAMMEM default OFF. |
| **2.7.31** | **densable 2.1.215 + 2.1.216 closeout**: 215 `/verify`·`/code-review` no model auto-invoke (HAVE 2); 216 **HAVE 38 / N/A 1 / GAP 0** (`sandbox.filesystem.disabled`, long-session normalize, auto-mode 401, worktree git isolation, daemon stop --any, bg/agents UX, Win network paths, fullscreen UI, skill menu hot refresh, `/rewind` symlink safety, etc.). Intentionally off: UDS/LAN/TEAMMEM; VSCode RTL N/A. |
| **2.7.30** | **densable 2.1.214 full 1:1 (47/47 HAVE)**: permission/Bash/PS safety valves; EndConversation; tool heartbeat; GrowthBook null payload + OAuth flag refresh; bg daemon control-socket/retire/deleteJob; RC session-ready push gate; stream cost / advisor stall / hooks exit2 / OTel / MCP list_changed; etc. Intentionally off: UDS/LAN/TEAMMEM. |
| **2.7.29** | **densable 2.1.212 closeout**: official 48 rows 0 GAP; `/fork` keepParent + `/subtask`; session caps / MCP auto-bg / auto-mode reset; ultrareview + Qre/code-sessions (OTe/KLc/H8/F1g/nts) 1:1. Intentionally off: UDS/LAN/TEAMMEM. |
| **2.7.28** | **Windows packaged clipboard paste**: when `bun --compile` cannot load sharp natives, fall back to System.Drawing resize/JPEG; dev still uses sharp. |
| **2.7.27** | **Prompt notification strip height**: absolute box height 2→1 so the latest notice does not paint over the prompt top border (e.g. clipboard image `alt+v` hint). |
| **2.7.26** | **Windows clipboard image paste**: PowerShell argv `shell:false` under Git Bash; empty paste on Windows; prefer PNG stream; client ≥8px floor rejects 1×1; Buddy/KAIROS docs aligned to densable 211. |
| **2.7.25** | **Host densable 211 production path**: permanent `model_not_found` → `system/model_fallback`; `system/background_tasks_changed` (REPLACE live set); mid-bg `didBackground` true flip; eviction keeps Host progress events. |
| **2.7.24** | **Official 2.1 Host stream/control + bypass 1g**: `command_lifecycle` / `thinking_tokens` / `task_updated` / `task_summary` / `background_tasks` (Ctrl+B); mid-bg emits `task_updated`; `backgroundAll` skips main-session agents; bypass allows `classifierApprovable` safetyChecks (densable 1g). |
| **2.7.23** | **Tasks dual-emit**: once-gated `system/task_notification` bookends (with ISO `timestamp`) when agent/shell/monitor/dream/workflow terminate so Host Tasks can settle on densable Jp; print residual re-emit once-gated — do not invent lifecycle from TaskOutput alone. |
| **2.7.22** | **REPL update banner / go-hare upgrade path**: drop default-off `ENABLE_AUTOUPDATER`; toast "Update available" even when `autoUpdates=false`; mount AutoUpdater in Notifications; treat npm-shipped binaries as `npm-global`; `claude update` targets `@go-hare/claude-code`. |
| **2.7.21** | **Workflow / ultracode densable alignment**: full playbook on the Workflow tool prompt (ONLY-call-when opt-in); `/ultracode` is user-only (`disableModelInvocation`), no wide whenToUse bootstrap. |
| **2.7.20** | **Workflow host densable alignment**: `/workflows` is history browser (GsK); live monitor is Tasks `WorkflowDetailDialog` (fv_) on `task.workflowProgress`; remove dual-pane `WorkflowsPanel`; add progress fold / SDK `task_progress` bridge and history navigation keybinding fix. |
| **2.7.19** | **Provider priority fix**: `modelType=anthropic` is no longer overridden by leftover `USE_OPENAI` / `USE_GEMINI` / `USE_GROK` env vars. |
| **2.7.18** | **Chrome multi-browser without OAuth**: expose and support local multi-browser tools even without OAuth (local Chrome MCP path). |
| **2.7.17** | **Claude in Chrome extension pipeline**: allow agent-extension fork ID by default with optional extra whitelist; local extension download via go-hare/agent-extension release; Install local opens the repo page; drop (Beta) suffix from `/chrome`. |
| **2.7.16** | **Host effort metadata**: `get_settings.applied` now includes `effortLevels` / `ultracodeOfferable` so the desktop host can render available effort tiers and the ultracode entry. |
| **2.7.15** | **Host Effort/Ultracode pipeline**: densable Host `get_settings.ultracode` + `apply_flag` direct write; `eee` strips fences before parsing so fenced JSON no longer spams ERROR. |
| **2.7.14** | **Paste fallback fix**: when image resize fails, fall back to a text notice instead of swallowing the whole turn. |
| **2.7.13** | **Paste Enter race fix**: clear footer on image paste so two shells no longer fight over Enter and drop the message; Fable consent rejection no longer writes sticky effort / N9. |
| **2.7.12** | **Post-paste typing dropped-message fix**: shared live ref so same-tick typing no longer overwrites an image paste pill; further Enter path alignment. |
| **2.7.11** | **Effort densable alignment**: model-driven effort resolve, ultracode session mode, ModelPicker pin convention, effort pin persistence; sticky-scroll blank-screen and effort toast same-key refresh fixes; text+image same-tick Enter dropped-message fix. |
| **2.7.10** | **Shell dialog hooks crash fix**: opening BackgroundTasksDialog skipped PromptInput's `onKeyDownBefore` useCallback after an early return ("Rendered fewer hooks than expected"); moved the hook before early returns and deferred onDoneEvent. |
| **2.7.9** | Full multi-platform binary rebuild/publish of current main (includes 2.7.8 Enter fix, etc.). |
| **2.7.8** | **Enter dropped-message fix**: densable-aligned Enter path (typeahead / history search / PromptInput) so submit no longer drops input in some states. |
| **2.7.7** | **OpenAI-compatible multi-bullet fix**: broken proxies that re-emit the full sentence with `finish_reason` on every chunk no longer open/close a new text block each time (`normalizeMessages` → one ● per block). Cumulative full-text deltas emit only the suffix; assemble collapses adjacent identical text blocks as a safety net. |
| **2.7.6** | densable streaming alignment: Esc salvages thinking only; streaming/final dual-● render fix; daemon lifecycle logs only (no stderr); quiet daemon takeover during agents handoff. |
| **2.7.5** | densable FileEdit/FileWrite result rendering; spinner uses main-thread queue length (no fake spin from subagents); idle-return keeps draft; OSe pruning does not write paste refs. |

---

## Install (npm)

Published name: **`@go-hare/claude-code`** (platform binaries as `@go-hare/claude-code-<os>-<arch>` optionalDependencies).

```sh
npm i -g @go-hare/claude-code

# Windows: if install hits EBUSY, kill the locked binary first
# taskkill /F /IM claude.exe

claude                 # start (postinstall places the native binary under bin/)
claude --version
claude agents          # background-session dashboard (needs daemon)
claude update

# Self-hosted Remote Control example (use your RCS URL / token)
CLAUDE_BRIDGE_BASE_URL=https://your-rcs.example/ \
CLAUDE_BRIDGE_OAUTH_TOKEN=your-token \
claude --remote-control
```

On install failure: `npm rm -g @go-hare/claude-code`, then install `@latest` again (or pin e.g. `@2.7.17`).  
Legacy docs that say `npm i -g claude-code` do **not** match this fork’s publish stream.

---

## Develop from source

### Prerequisites

Use a recent [Bun](https://bun.sh/) (recommended ≥ 1.3.11):

```bash
curl -fsSL https://bun.sh/install | bash   # macOS / Linux
# Windows: powershell -c "irm bun.sh/install.ps1 | iex"
bun upgrade
```

### Install & run

From the **repo root** (directory with this `package.json`):

```bash
bun install
bun run dev          # dev mode (MACRO.* injected by scripts/dev.ts)
bun run build        # code-split output → dist/cli.js + chunks
bun run precheck     # typecheck + biome fix + full test suite
```

Cross-platform binaries and publish:

```bash
bun run build:compile                          # compile platform binary only
bun run scripts/publish.ts --build-only        # same via publish script
bun run scripts/publish.ts --dry-run           # build + npm publish --dry-run
bun run scripts/publish.ts --with-main         # include main @go-hare/claude-code
```

> The `claude` binary inside platform packages is **build output** and should not live in git long-term.

### `/login` model config

In the REPL, `/login` can select Anthropic Compatible / OpenAI / Gemini / etc.:

| Field | Example |
| ----- | ------- |
| Base URL | `https://api.example.com/v1` |
| API Key | `sk-xxx` |
| Haiku / Sonnet / Opus | model IDs for your upstream |

Tab / Shift+Tab moves fields; Enter confirms.

### Feature flags

```bash
FEATURE_BUDDY=1 bun run dev
```

The build enables a default set of flags (see `build.ts` / `scripts/defines.ts`). **ON by default**: `UDS_INBOX` / `LAN_PIPES` / `TEAMMEM` / `KAIROS`+periphery (channels/push/webhook). Still off: `FORK_SUBAGENT`, `ULTRAPLAN`, and others.

### VS Code debugging

TUI needs a real terminal — attach:

```bash
bun run dev:inspect   # prints ws://localhost:…
```

VS Code F5 → **Attach to Bun (TUI debug)**.

### Teach Me

```text
/teach-me Claude Code architecture
/teach-me React Ink terminal rendering --level beginner
```

Progress lives under `.claude/skills/teach-me/` when the skill is installed.

---

## Layout (short)

| Path | Role |
| ---- | ---- |
| `src/entrypoints/cli.tsx` | True entry + fast paths |
| `src/main.tsx` | Commander CLI and startup |
| `src/screens/REPL.tsx` | Interactive REPL |
| `src/query.ts` / `QueryEngine.ts` | API query and turn orchestration |
| `packages/builtin-tools/` | Built-in tools |
| `packages/@ant/ink/` | Terminal Ink framework |
| `src/bridge/` / `packages/remote-control-server/` | Remote Control |
| `src/daemon/` | Long-lived daemon |
| `src/services/acp/` / `packages/acp-link/` | ACP |
| `scripts/publish.ts` | Platform binary compile + npm publish |
| `CLAUDE.md` | Detailed engineering notes for agents / contributors |

More architecture and testing rules: [`CLAUDE.md`](./CLAUDE.md).

---

## Contributors

<a href="https://github.com/go-hare/claude-code-1/graphs/contributors">
  <img src="contributors.svg" alt="Contributors" />
</a>

## Star History

<a href="https://www.star-history.com/?repos=go-hare%2Fclaude-code-1&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=go-hare/claude-code-1&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=go-hare/claude-code-1&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/image?repos=go-hare/claude-code-1&type=date&legend=top-left" />
  </picture>
</a>

## Acknowledgments

- [doubaoime-asr](https://github.com/starccy/doubaoime-asr) — Doubao ASR for optional Voice Mode path

## License

For learning and research only. Claude Code rights belong to Anthropic. Respect upstream and dependency licenses.
