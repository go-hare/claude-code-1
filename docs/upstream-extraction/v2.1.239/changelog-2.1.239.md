# densable 2.1.239 — Changelog

> 来源：GitHub/`CHANGELOG.md` **## 2.1.239**  
> Tag：[`v2.1.239`](https://github.com/anthropics/claude-code/releases/tag/v2.1.239) · raw：[CHANGELOG.md](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md) · docs：[code.claude.com changelog](https://code.claude.com/docs/en/changelog)  
> SEA：`%TEMP%\official-239\package\claude.exe` · `2.1.239 (Claude Code)` · size **337672352** · sha256 `0bc1304c7847c317cc550007e7561f9bf270eaa68a0e85a3f381afb18ee20a2b`  
> npm plat：`@anthropic-ai/claude-code-win32-x64@2.1.239` · tarball shasum `816d5c8487c423a66b422231c150c9b4f342ec53`  
> 口径：Changelog + checklist **盘点 only**（本文件）· invent-ban · no auto commit/push/bump  
> 更新：2026-08-24

## What's changed（官方原文 · 59 bullets）

1. Cost estimates (`/cost`, status line, `--max-budget-usd`) now include the 1.1× US-only-inference premium for data-residency workspaces
2. Added the one-time fullscreen renderer offer on Bedrock, Vertex, Foundry and other previously excluded setups; new installs there now start in fullscreen
3. Added `/claude-api upgrade` to migrate Python projects from `anthropic` 0.x to 1.x, and updated the skill's Python reference for 1.x (timeouts use `anthropic.Timeout`, not `httpx.Timeout`)
4. Cloud sessions: plugins synced from claude.ai now show as `name@synced`, work with `claude plugin enable/disable @synced`, and never override a same-named plugin you installed
5. Alpine/musl builds: native image paste, clipboard, and audio-capture add-ons now load (musl-built binaries instead of glibc ones refused by the runtime)
6. The usage-limit message shown when your monthly spend limit is already used up now also says when your session or weekly limit resets
7. Fixed Bedrock streaming behind proxies that strip the response Content-Type header, which silently doubled billed API calls by re-running every turn non-streaming
8. Fixed Claude Code hanging at startup behind an HTTPS proxy when using Bedrock with an SSO profile and `awsAuthRefresh` — the credential pre-check now honors `HTTPS_PROXY`
9. Fixed a raw crash dump when starting Claude Code from a directory that no longer exists; it now prints a clear message
10. Fixed Edit and Write calls pausing for about 5 seconds in JetBrains IDE terminals when the Claude Code plugin is connected
11. Fixed a race where pressing Esc with a prompt queued could let the next turn finish early, leaving the session idle while Claude was still working and letting a later resubmit repeat actions
12. Fixed WebFetch retaining expired page content in memory for the whole session instead of the intended 15 minutes
13. Fixed cloud sessions (Claude Code on the web, desktop and mobile apps) resuming out of plan mode after an idle worker restart
14. Fixed MCP elicitation forms taller than the terminal being clipped in fullscreen mode: the form now fits the window, with hidden fields reachable by scrolling and Accept/Decline always visible
15. Fixed remote MCP servers staying failed after a transient 5xx on a mid-session reconnect in cloud sessions or via SDK `setMcpServers()`
16. Fixed custom session titles disappearing from `/resume` after more than ~64 KB of conversation was written following the rename
17. Fixed `claude -c`/resume picking up sessions from a different directory whose path differed only by characters like `_`, `-`, or `.`
18. Fixed `/resume` and the agents view showing a session as recently changed (and reordering it) when only its file was touched or it was merely reopened
19. Fixed `/resume` in all-projects mode telling you to `cd` into a deleted directory (e.g. a removed worktree); such sessions now resume in the current directory
20. Fixed the `dark-ansi` theme rendering expanded tool results in fullscreen mode with text the same color as the background
21. Fixed the fullscreen renderer prompt reappearing on every launch when it could never be answered; it now stops after being shown on three launches
22. Fixed `.worktreeinclude` patterns starting with `**/` silently matching nothing when the target lived in a gitignored directory
23. Fixed agents, skills, and commands whose `.md` file starts with a UTF-8 BOM being silently ignored
24. Fixed `/insights` echoing literal ` ` tags in its response on some models
25. Fixed marketplace `metadata.pluginRoot` having no effect: bare plugin source names now resolve under it as the docs describe
26. Fixed mouse movement in browser-based terminals inserting text like `"35;150;7M"` into the prompt when a mouse report arrived split across writes
27. Fixed custom theme overrides for the effort/ultracode status badge colors being ignored
28. Fixed OpenTelemetry trace fragmentation: tool executions deferred by a `PreToolUse` hook now resume in the original turn's trace instead of starting a new trace
29. Fixed vim mode in the agent view: Escape now switches to NORMAL mode and keeps your text instead of clearing the prompt
30. Fixed the `selection:copy` keybinding silently dropping a text selection that had been extended with Shift+Arrow keys
31. Fixed the `/voice` startup tip still appearing after voice dictation was enabled via the `voice.enabled` setting
32. Fixed shell-mode (`!`) Tab completion dropping the `./` from a `./script` path, which left a command the shell couldn't run
33. Fixed fullscreen mode answering a permission prompt or pressing a button when you clicked the terminal window only to bring it back into focus
34. Fixed slash-command panels (e.g. `/config`, `/model`) in fullscreen mode covering the latest messages; the conversation now stays pinned above the panel
35. Fixed the `/workflows` detail dialog overflowing the terminal and losing its header off-screen when opened while Claude is still responding
36. Fixed the Linux sandbox making a nonexistent `.git/config.worktree` unreadable, which broke every sandboxed git command in repos with `extensions.worktreeConfig` set
37. Fixed hooks failing with "posix_spawn ENOENT" after the session's working directory was deleted; they now run from the project root or home directory instead
38. Fixed `claudeMdExcludes` not excluding a symlinked `.claude/rules` file when the pattern names the rules directory or the symlink rather than its target
39. Fixed runaway session-title syncing to Remote Control when two Claude Code processes shared one background job's state (2.1.232 regression); title updates are now deduplicated and rate-limited
40. Fixed sessions whose title starts with `/` being unaddressable by `SendMessage` and shown as "(untitled)" in `ListAgents`
41. Fixed Ctrl+W, Ctrl+U, Ctrl+K, Option+Backspace, Option+D and vim `df`/`dt` leaving a broken `[Pasted text #N]` placeholder when the cursor was inside it
42. Fixed masked (password-style) inputs such as the login code field letting their text be pasted back with Ctrl+Y elsewhere or saved to prompt history when cleared with double Esc
43. Fixed Ctrl+Backspace deleting one character instead of a word in search boxes
44. Fixed a request rejected by an organization policy check being re-sent before the rejection was shown
45. Improved the reminder shown after compaction so a skill's original arguments are not re-run as a new request
46. Long file paths on tool-use rows now truncate in the middle to stay on one line
47. Remote sessions keep sending keep-alives while a long `SessionStart` or `Setup` hook runs, so the container is not idle-reaped mid-hook
48. `/goal`: repeat check-ins on long-running background work now back off (30 min, then 1 h, then every 2 h) instead of repeating every 30 minutes
49. `/goal`: resuming a session from the `claude --resume` picker now restores its active goal
50. `ListAgents` now tells a session its own name (the one peers use to message it), and `SendMessage` to your own name says so instead of "no agent named …"
51. `ListAgents` and `/list-agents` now list your live teammates (previously only subagents and other sessions appeared, so a reachable teammate looked absent)
52. `keybindingFlavor: "readline"` now also matches Bash for word keys: Alt+F and Ctrl/Option+→ stop at the end of the word, Alt+D deletes to it (Ctrl+Y pastes it back), and punctuation separates words
53. Persistent retry mode (`CLAUDE_CODE_RETRY_WATCHDOG`) now fails immediately on organization spend-limit and out-of-credits errors instead of waiting indefinitely for a reset
54. Claude in Chrome: `/clear` now closes the session's Chrome tab group, and empty groups are closed on `/resume` and when Claude Code exits
55. Remote sessions: images uploaded from mobile now include their saved file path, so Claude can copy them into files it creates
56. Claude Code on the web: requests from Bash and other tools to non-API anthropic.com hosts (e.g. www, docs) now go through the session's network proxy, so your environment's allowed domains apply
57. Remote Control: clearer message and `claude doctor` wording when Remote Control isn't enabled for your account
58. Windows: cross-session messaging is now available, so Claude Code sessions across your machines can message each other with `SendMessage` and find each other with `ListAgents`, as on macOS and Linux
59. [VSCode] "View usage" in the usage-limit banner now sits inline with the warning text instead of floating mid-banner

## SEA 指纹

| 项 | 值 |
| -- | --- |
| path | `%TEMP%\official-239\package\claude.exe` |
| `--version` | `2.1.239 (Claude Code)` |
| size | 337672352 |
| sha256 | `0bc1304c7847c317cc550007e7561f9bf270eaa68a0e85a3f381afb18ee20a2b` |
| npm plat | `@anthropic-ai/claude-code-win32-x64@2.1.239` |
| tarball shasum | `816d5c8487c423a66b422231c150c9b4f342ec53` |
| unpacked | 337672922 |

## 初盘摘要（粗标 · 等 dig）

| 桶 | # | 说明 |
| -- | - | ---- |
| **HAVE** | 1 | #48 `/goal` backoff 已是 236 金标（30→60→120 / `jsv=2`） |
| **PARTIAL** | 3 | #3 skill 有、缺 `upgrade` 文 + 仍写 `httpx.Timeout` · #52 readline 仅 Ctrl+W · #58 win32 named pipe 骨架（228）未对照 239 合同 |
| **GAP** | 2 | #3 `/claude-api upgrade` 可执行文 · #4 `name@synced` 字面 0 hit（云端插件面） |
| **N/A** | 3 | #5 musl addon（本 pack 是 win32 SEA）· #54 Chrome tab group invent-ban · #59 VSCode host |
| **UNKNOWN** | 50 | 其余 — SEA 有相关字面但 tip 未逐条挖 |

### 粗标备注

- tip baseline：densable **238 leftover** 已落地（`957e5c0e`）+ npm **2.7.46**。
- #1：`US-only` SEA 2 hit 是 WebSearch 文案，**不是** 1.1× residency premium；cost 乘数金标未锁。
- #3：SEA 有完整 `# Upgrading the anthropic Python SDK: 0.x → 1.x`（via `/claude-api upgrade`）+ `anthropic.Timeout` / `httpx2`。
- #48 changelog 是 236 已落地行为的复述，**不**再 invent 另一套 interval。
- invent-ban：不 invent Chrome UI / VSCode host / storageV5 / Desktop·cloud handoff / leftover #3 `identity_changed` / G0S。
- 邻版：官方 CHANGELOG 已有 **2.1.240 / 2.1.241**（仅 “Bug fixes and reliability improvements”）。**本 pack 只盘 239**。

## 工件

- checklist：`official-239-checklist.md`
- board：`boards/alignment-239.md`
- snippets：`snippets/probe-239.mjs` · `snippets/extract-239.mjs` · `snippets/gold-*.txt`
