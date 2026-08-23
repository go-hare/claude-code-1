# densable 2.1.238 — Changelog

> 来源：GitHub/`CHANGELOG.md` **## 2.1.238**（npm publish ~2026-08-20T18:01Z；docs modified ~2026-08-20）  
> Tag：[`v2.1.238`](https://github.com/anthropics/claude-code/releases/tag/v2.1.238) · raw：[CHANGELOG.md](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md) · docs：[code.claude.com changelog](https://code.claude.com/docs/en/changelog)  
> SEA：`/tmp/official-238/plat/package/claude` · `2.1.238 (Claude Code)` · size **321263536** · sha256 `1c196c456373b57818ae87df84aecee96cb659448c0d6a6bbb401ac5758431b2`  
> vs 237：size Δ **+4153248** B（237 = 317110288 / `338901351d…`）  
> 口径：Changelog + checklist **盘点 only** · **不落地代码** · invent-ban · no auto commit/push/bump  
> 更新：2026-08-21

## What's changed（官方原文 · 39 bullets）

1. Added a `keybindingFlavor` setting: set it to `"readline"` to make Ctrl+W in the prompt delete back to the previous whitespace, as in Bash; the default (`"classic"`) is unchanged
2. Plugin marketplaces: `headersHelper` on a url marketplace or a catalog entry runs a command that mints HTTP headers (e.g. a short-lived token) for catalog and same-origin archive fetches
3. A catalog entry's `headersHelper` runs only when you install or update that plugin, after its command is shown; `claude plugin install/update` ask `[y/N]` (or pass `-y`)
4. Added `claude self-hosted-runner --defer-shutdown-max-min <minutes>`: on SIGTERM, keep serving attached sessions, park what is left after that many minutes, then exit
5. Added `claude self-hosted-runner --proxy-authorization-command` / `--proxy-authorization-file` for egress proxies that require a freshly issued `Proxy-Authorization` header on every connection
6. Fixed unbounded memory growth in long interactive sessions: subagent tool results are now released once they leave the recent display window
7. Fixed custom, project, and plugin output styles drifting back to the default voice mid-session
8. Fixed `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=true` not keeping prompt suggestions on when your account is near, but not over, its usage limit
9. Fixed worktree-isolation Bash refusals telling you to remove a redirect when the command had none
10. Fixed self-hosted runners occasionally being removed by the server after a single slow or lost poll request, handing their healthy session to another runner
11. Fixed MCP elicitation dialogs showing nothing for URLs longer than 4,096 characters, and permission prompts dropping the "don't ask again" option when the project path didn't fit the terminal width
12. Fixed leftover `/tmp/claude-*-cwd` files when a Bash command is killed, times out, or is interrupted
13. Fixed held Backspace being ignored on terminals that send Ctrl+H for Backspace when keystrokes arrive in large bursts (slow SSH/mosh links)
14. Fixed text-wrapping in permission prompt diffs: lines containing wide multi-code-point characters (such as emoji) or tabs are no longer clipped
15. Fixed killing a suspended (Ctrl+Z) session sometimes leaving the terminal in bracketed-paste mode with the cursor hidden
16. Fixed stdio MCP servers receiving a `server/discover` request before `initialize`, forcing lazy servers to start their backend on every session open
17. Fixed a proxy's refusal of a connection being reported as a generic network error instead of naming the proxy
18. Fixed the `/model` and `/effort` cache-miss warning appearing when the prompt cache had already expired
19. Fixed per-task Stop from the Remote Control tasks panel doing nothing on CLI-hosted sessions
20. Fixed remote sessions exiting when a client delivered a user message without a valid role
21. Fixed Remote Control sessions started by `claude remote-control` inheriting session-scoped environment variables from the launching shell
22. Fixed a Remote Control session whose process crashed staying unavailable until `claude remote-control` was restarted; it can now be reused when you next message it
23. Fixed Remote Control messages sent from the web or Desktop while Claude is mid-turn disappearing from the transcript after the turn finishes
24. Fixed Remote Control model picks made on a phone or web not updating the model shown in the terminal
25. Fixed Remote Control disconnecting with "login expired" when a brief network hiccup delays renewing your sign-in; it now retries and stays connected
26. Fixed Remote Control reporting a failed reconnect on sign-out; signing out now ends the session with a clear message
27. Fixed `ListAgents`/`SendMessage` reporting "Remote Control is not connected" in sessions run by `claude remote-control` (server mode) or Desktop/IDE hosts; they now list and reach Remote Control peers
28. Fixed `ListAgents` and `SendMessage` exposing the idle worker that the agent view pre-warms for your next background session; it now appears only once a task claims it
29. Cross-session messaging: sending to a session on this machine that refuses inbound messages (e.g. `crossSessionInbound: "refuse"`) now reports "refused" to the sender instead of a silent success
30. Cross-session messaging: a session whose inbox drops your messages (rate limit or full queue) now tells your session, instead of the messages vanishing silently
31. Improved startup: bare `claude` starts sooner on macOS
32. Improved Bash tool permission checking for zsh-specific syntax in shell conditionals
33. Improved Remote Control connection resilience: brief HTTP 403 refusals from a network edge, VPN, or proxy are now tolerated for up to 3 minutes, with the refusing party named when a block persists
34. Improved startup responsiveness: the automatic update check now runs about 10 seconds after launch instead of competing with startup for CPU
35. Updated the bundled `claude-api` skill for the Managed Agents Aug 19 release: web search/fetch domain settings and memory stores on self-hosted sandboxes
36. Changed Ctrl+L and Cmd+K in fullscreen to always just repaint — the double-press `/clear` shortcut was removed, and 1-row nvim terminals no longer trigger automatic `/clear` loops
37. Changed `claude mcp list` and `claude mcp get` to show disabled servers as `⊘ Disabled` instead of connecting to them for a health check
38. MCP `headersHelper` in a project `.mcp.json`, and inline MCP servers in project or `--add-dir` agent files, now require that folder's trust dialog to have been accepted (also under `claude -p`)
39. MCP `headersHelper` from a project `.mcp.json`, plugin, or agent file runs without inherited credential env vars; user, managed and claude.ai-scope helpers now run from the Claude config dir

## SEA 指纹

| 项 | 值 |
| -- | -- |
| path | `/tmp/official-238/plat/package/claude` |
| `--version` | `2.1.238 (Claude Code)` |
| size | 321263536 |
| sha256 | `1c196c456373b57818ae87df84aecee96cb659448c0d6a6bbb401ac5758431b2` |
| npm plat | `@anthropic-ai/claude-code-darwin-arm64@2.1.238` |
| tarball shasum | `d658798e7455ac0db9baf43b3461234b2466cf2a` |

## 初盘摘要（粗标 · 等 dig）

| 桶 | # | 说明 |
| -- | - | ---- |
| **GAP（产品新增）** | 5 | #1 keybindingFlavor · #2 marketplace headersHelper · #3 catalog helper confirm/`-y` · #4 defer-shutdown-max-min · #5 proxy-authorization-\* |
| **PARTIAL（有骨架）** | 4 | #12 cwd 文件路径已有、清理合同未锁 · #29/#30 tip 已有 refuse/inbox 文案骨架 · #35 bundled skill 可能旧 |
| **UNKNOWN** | 30 | 其余 fix/improve/change — SEA 字面量有命中但 tip 对照未深挖 |
| **HAVE** | 0 | 本 pack 未宣称 1:1 完成项 |
| **N/A** | 0 | 无 VSCode-only invent；Desktop/IDE 仅作 RC 宿主上下文，不 invent gateway |

### 粗标备注

- tip baseline：densable **237 HAVE**（`1fcb0818`）+ **236 #25 invent**（`f5987063`）；npm tip **2.7.45**。
- tip `headersHelper` **已有**（MCP / plugin MCP 集成，自 2.1.193/206/207）；**#2/#3 是 marketplace/catalog 面**，勿把 MCP helper 误标 HAVE。
- tip `self-hosted-runner` help 有 `--drain-wait-sec` / `--session-stop-grace-sec`，**无** `--defer-shutdown-max-min` / `--proxy-authorization-*` → #4/#5 **GAP**。
- tip settings schema **无** `keybindingFlavor`（有 `editorMode` / `vimInsertModeRemaps`）→ #1 **GAP**。
- invent-ban：不 invent Proactive · VSCode host · storageV5 · Desktop·cloud handoff · 「假 ⊘ 文案」；不折入未点名产品。

## 工件

- checklist：`official-238-checklist.md`
- board：`boards/alignment-238.md`
- progress：`artifacts/alignment-238-progress.md`
- snippets：`snippets/changelog-238-section.md` · `snippets/sea-strings-probe.txt`
