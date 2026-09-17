# densable 2.1.243 — Changelog

> 来源：GitHub/`CHANGELOG.md` **## 2.1.243**（2026-08-24）  
> Tag：[`v2.1.243`](https://github.com/anthropics/claude-code/releases/tag/v2.1.243) · raw：[CHANGELOG.md](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md) · docs：[code.claude.com changelog](https://code.claude.com/docs/en/changelog)  
> SEA：已下载（win32-x64 `@anthropic-ai/claude-code-win32-x64@2.1.243`）。  
> 口径：densable-first 1:1 · invent-ban · no auto commit/push/bump  
> 更新：2026-09-02

## SEA 指纹

| 项 | 值 |
| -- | -- |
| npm | `@anthropic-ai/claude-code-win32-x64@2.1.243` |
| `--version` | `2.1.243 (Claude Code)` |
| `claude.exe` size | 370827424 |
| sha256 | `895a32a66e8a35a85fc7b9488e9858387cfd96829efda0cab96d14ba8e28c200` |
| tarball shasum | `5cb4ccc7e6ddda61abffb284a1f9a44153d52361` |

## What's changed（官方原文 · 60 bullets）

编号跟 GitHub `CHANGELOG.md` **## 2.1.243** 原文顺序，不跟第三方站点的 Added/Improved/Fixed 重排。

1. Added a Loops breakdown to `/usage`: per-loop run count, total tokens, tokens per run, and last run, so runaway or chatty `/loop` tasks are easy to spot
2. Added `modelPicker` setting: curate the `/model` picker with an ordered, labeled list of models (any id spelling, including Vertex/Bedrock ids), appended to or replacing the built-in lineup
3. Added `promptCacheTtl` and `subagentPromptCacheTtl` settings so API-key and cloud-provider users can keep a 1-hour prompt cache on the main conversation while subagents stay at 5 minutes
4. Added `modelPricing` managed setting so an organization's contracted per-model rates and discount multiplier are used for `/cost`, the status line, and telemetry cost figures instead of list price
5. Added a keyless sign-in under `/login` → Anthropic Console: "Sign in with your Console account" (recommended) alongside creating an API key, so organizations that don't allow API keys can sign in
6. Added a `Skipped sources` line to `/status` that lists managed settings sources (for example `managed-settings.json`) present but not applied because a higher-precedence managed source is active
7. Added a `managed` marker in `/mcp` and `/plugins` on claude.ai connectors whose authentication is managed by your organization
8. Added a tip pointing claude.ai users who haven't connected GitHub for Claude Code on the web to `/web-setup`
9. Added a `/status` line showing whether GitHub is connected for Claude Code on the web (Pro/Max), pointing to `/web-setup` when it isn't
10. Added the model (and effort level) each subagent ran on to `/tasks` and the agent detail dialogs
11. Fixed remote MCP servers in non-interactive (`-p`) and SDK sessions never recovering after a dropped connection; they now reconnect automatically or report as failed
12. Fixed MCP server sign-in started from the desktop app failing with "Invalid redirect URI" on servers that support client ID metadata documents (for example Linear)
13. Fixed auto mode staying unavailable at startup when a temporary server-side disable was cached and later flag fetches failed
14. Fixed auto mode tool calls being denied as "temporarily unavailable" after about a minute of waiting when the API was briefly overloaded and asked the client to retry
15. Fixed the `/model` picker silently ignoring an Ultracode selection; picking Ultracode now applies it to the current session
16. Fixed `/resume` only listing the 50 most recent sessions; the picker now loads more as you scroll
17. Fixed cloud sessions resuming after a mid-turn restart with a pending hook or background-task notification re-sent as the prompt instead of the normal continuation message
18. Fixed cross-session messaging silently turning off inside user namespaces and rootless containers after the 2.1.232 socket-directory hardening
19. Fixed text that hangs outside its container (for example the sign-in URL in `/login`) losing its leading columns when another part of the screen repaints
20. Fixed `spellcheck` not underlining a misspelled word typed directly after an emoji
21. Fixed background subagents not waking when their last background Bash task completes
22. Fixed sessions going silent for 10+ minutes when the Anthropic API never starts a response: the request now times out after ~3 minutes, retries once, then shows `API Error: No response from API`
23. Fixed auth, model-availability, and other client-generated error messages rendering like model output instead of as error lines
24. Fixed workload identity federation in CI: processes in one job share the exchanged token instead of re-exchanging the single-use token; a rejected exchange fails fast with the server's message
25. Fixed server-managed `companyAnnouncements` not showing at startup in a session that began with signing in (for example the first launch after `/logout`)
26. Fixed hook `if` conditions like `Bash(cat *)` firing on unrelated Bash commands when the command contained `$()` or backtick command substitution followed by more arguments
27. Fixed plugin dependencies declared with a `marketplace` field never resolving when both plugins are loaded together via `--plugin-dir`
28. Fixed `/reload-plugins` keeping the LSP tool after the last LSP plugin is disabled; it now also warns before an LSP plugin change that would re-read the conversation
29. Fixed `--agents` silently ignoring invalid JSON or invalid agent definitions; it now exits with a clear error, like `--mcp-config`
30. Fixed `/status` showing "Found invalid entries in: ." with no filename when `~/.claude.json` has an invalid MCP server entry
31. Fixed `/clear` removing the `/rename` session name from the prompt bar even though the name was kept for the new session
32. Fixed Ctrl+R history search and up-arrow history breaking when `~/.claude/history.jsonl` contains a malformed entry
33. Fixed Ctrl+[ not leaving vim INSERT mode in terminals that encode modified keys (modifyOtherKeys / kitty protocol)
34. Fixed the local IDE connection being routed through `HTTPS_PROXY` (and sometimes failing) when `localhost` was listed in `NO_PROXY` but not lowercase `no_proxy`; both casings are now honored
35. Fixed sandbox network-violation details being dropped from the Bash tool result when the blocked command still exited 0 (for example `curl` printing the proxy's 403 page)
36. Fixed the status line `rate_limits` fields and `/usage` still showing a rate-limit window's pre-reset usage percentage after the window reset while the session was idle
37. Fixed `claude --teleport` exiting on uncommitted changes instead of offering to stash them and continue, as the session picker already does
38. Fixed `/web-setup` repeatedly asking you to log in when an older GitHub CLI (without `gh auth token`) was already authenticated
39. Fixed Claude in Chrome losing its connection to Claude Code after an auto-update cleaned up the version it was set up with; the native host now launches via the stable `claude` launcher
40. [VSCode] Fixed sessions started before feature flags were first fetched (for example right after install) opening in the default permission mode instead of auto mode or your configured default mode
41. [VSCode] Fixed Focus view sections you expanded collapsing on their own during subagent tool activity
42. Improved startup time: sandbox and MCP bring-up no longer block the first frame, bare launches skip subcommand registration, and workflow discovery, settings, and trust-store work is cheaper
43. Improved native install and auto-update download size: the binary is now zstd-compressed (about 75 MB instead of 340 MB on Linux x64)
44. Improved attribution of usage telemetry to your organization for sessions that authenticate with `ANTHROPIC_AUTH_TOKEN` directly against the Anthropic API, so its data-handling settings apply
45. Improved native binary size: about 2 MB smaller by storing the bundled skill and prompt text more compactly
46. Improved memory usage of native builds: code is now loaded on demand instead of keeping the whole bundle resident (roughly 40–70 MB less memory per session)
47. Improved peak memory usage in long-running sessions (the runtime now garbage-collects sooner as the heap grows)
48. Improved `/login` over SSH: the sign-in URL appears immediately, pressing `c` reports how the URL was copied instead of always claiming success, and a hint explains how to select text in fullscreen
49. Improved the error when effort `xhigh`/`max` is used with thinking turned off: it now names the level, the setting that disabled thinking, and `/effort high` as the fix
50. Improved `/loop`: consecutive wake-ups where Claude has nothing to do now fold into a single line in the terminal instead of printing each one
51. Changed the sandboxed Bash tool prompt to no longer list allowed network hosts, so Claude attempts requests (and you can approve new hosts) instead of assuming unlisted hosts are blocked
52. Updated the `/model` picker and the bundled `claude-api` skill to show Sonnet 5's $2/$10 per Mtok pricing as its standard list price rather than a limited-time promo
53. Changed computer use on macOS so clicking the desktop, Dock, or a Finder window requires granting Finder via the access dialog, like any other app
54. Changed `/model`, `/fast`, and `/effort` to also run immediately instead of queueing until the turn ends on Bedrock, Vertex, and Foundry and when telemetry is disabled
55. Fixed `claude remote-control` exiting and stranding attached Remote Control sessions when the server drops its environment mid-session; it now recovers
56. Fixed Remote Control sessions served by `claude remote-control` sometimes getting stuck after it was stopped and restarted, for Team and Enterprise members without an admin or owner role
57. Changed the cross-session messaging inbox socket to close connections that send no complete line within 30 seconds; scripts posting to it should connect once their data is ready
58. Improved the notice when resuming a conversation whose Remote Control is held by another terminal: it now says sessions on other machines can't be seen from, or reach, this one
59. [VSCode] Improved history trimming in long sessions: older tool-activity rows are dropped first so your messages and Claude's replies stay visible
60. [VSCode] Improved attribution of the extension's own usage telemetry to your organization when you are signed in with a Claude account, so its data-handling settings apply

## 邻版（勿折入本 pack）

| 版本 | 官方 CHANGELOG |
| ---- | -------------- |
| **2.1.240** | 仅 “Bug fixes and reliability improvements”（无 bullets） |
| **2.1.241** | 同上 |
| **2.1.242** | **无此节**（官方跳号，同 230） |
| **2.1.244** | **无此节** |
| **2.1.245** | 1 条：glibc 2.44 Linux startup crash |
| **2.1.246–2.1.248** | 官方 tip 已到 **2.1.248**。**本 pack 只盘 243** |

## 对齐摘要

| 桶 | # | 说明 |
| -- | - | ---- |
| **HAVE** | **49** | #1–#11 #13–#16 #18–#39 #44 #48–#58 |
| **PARTIAL** | **0** | — |
| **GAP** | **0** | — |
| **N/A** | **11** | VSCode 四条 + Desktop/cloud/官方 installer · 同缺 = 已对齐 |
| **UNKNOWN** | **0** | — |

### 粗标备注

- tip baseline：densable **2.1.243** 已落地 + npm **2.7.48**（叠在 239 leftover / 2.7.47 上）。
- `#2` 的 `modelPicker` **setting**（策划 `/model` 列表）≠ tip 已有的 `ModelPicker` UI / `chat:modelPicker` 快捷键。勿把现成 picker 组件当成 HAVE。
- `#8`/`#9` 已按 SEA 文案落地；`#38` 旧 `gh`（无 `gh auth token`）已 HAVE（`yh` + `gh_too_old`）。
- `#12` Desktop CIMD / `#17` 云端 mid-turn：宿主面 **同缺 = 已对齐**（239 已钉）。只挖 CLI OAuth / resume 对等。
- `#24` `lt`=`invalidateWifToken` 已接 `withRetry` profile 401；`lt` 清 last-issued；不 pin rejected disk；pending 在 pin 前合并。
- `#37` `--teleport` stash：223 云 session 产品面 **已对齐（非缺口）**。本条只盘 CLI stash 合同。
- `#42`–`#47` 官方 native 安装/运行时体积 · go-hare **同缺**，不 invent installer。
- VSCode / Desktop·cloud / storageV5 / cowork **不是 243 待办**。storageV5 `Rc` 已 HAVE；其余同缺 = 对齐。勿再写进「还差」。
- **本 pack 已收口**；下一 pack 才看 245–248。

## 工件

- checklist：`official-243-checklist.md`
- board：`boards/alignment-243.md`
