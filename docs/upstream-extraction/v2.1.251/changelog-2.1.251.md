# densable 2.1.251 — Changelog

> 来源：GitHub/`CHANGELOG.md` **## 2.1.251**（2026-08-28）  
> Tag：[`v2.1.251`](https://github.com/anthropics/claude-code/releases/tag/v2.1.251) · raw：[CHANGELOG.md](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)  
> SEA：**已下** `%TEMP%\official-251\package\claude.exe`（217360032 bytes，`--version` 2.1.251）。checklist/board 已开。changelog **只是索引**。函数体未锁前不升 HAVE。  
> 口径：densable-first 1:1 · invent-ban · **只盘 251**（249 跳号、250 stub 不折入；252 四条 hotfix 另包）  
> 基线：本地 tip npm **2.7.51** = densable **2.1.248**。  
> 更新：2026-09-22 — 开 pack。无函数体前不升 HAVE。

## What's changed（官方原文 · 71 bullets）

编号跟 GitHub `CHANGELOG.md` **## 2.1.251** 原文顺序。

1. Added `PreModelSwitch` and `PostModelSwitch` hook events (block, confirm, or annotate a model switch); `SessionStart` resume hooks now receive session staleness and the estimated re-cache cost
2. Added live streaming of a foreground subagent's tool calls and results to Remote Control clients (background subagents, the default, still show status only)
3. Added a Spend limit bar to `/usage` and a `rate_limits.spend_limit` status line field for developers behind a Claude apps gateway with spend limits
4. Added a per-session prompt-cache line to `/cost` (hit ratio, misses, tokens re-cached, warm/cold) and a matching `prompt_cache` object for status line scripts
5. Added `attach`, `logs`, `stop`, `respawn`, and `rm` to `claude --help`; the `--resume` message for a running background session now names the exact `claude attach ` command
6. Fixed file tools (Read, Write, Edit) following a symlink swapped inside the working directory after the permission check, which could read or write outside the approved location
7. Fixed plugin commands declared in a marketplace entry being able to point outside the plugin directory; such paths are now rejected with a path-traversal error
8. Fixed project settings being able to enable detailed beta tracing or raw API body logging, and a lower-scope beta tracing endpoint bypassing an OTLP collector pinned by managed settings or a host app
9. Fixed the Workflow tool reading (and quoting in errors) a `scriptPath` outside what the session may read before the permission check ran
10. Fixed Grep and Glob not applying `Read(...)` deny rules to files reached through a symlinked search path
11. Fixed conversations getting stuck on "text content blocks must be non-empty" errors after a turn where the model produced only thinking
12. Fixed the first launch on a fresh install starting in default mode instead of auto mode for accounts whose startup default is auto mode
13. Fixed Opus 5 requests failing with "effort … is not supported when thinking is disabled" when effort was xhigh/max and thinking was turned off; effort is now sent as `high` in that case
14. Fixed replying to a message Claude Desktop delivered from another session: `SendMessage` to that session id now delivers through Claude Desktop instead of failing with "not reachable"
15. Fixed TUI lag with many parallel subagents: per-second progress ticks now replace their predecessor instead of piling up in the transcript
16. Fixed agent teams: a teammate's final answer not reaching the team lead — it now arrives in the idle notification instead of a content-free "available" notice
17. Fixed background subagents being unable to reply to a message from an unnamed sibling or parent agent (`from` was the agent type, which is not an address)
18. Fixed managed-settings `disableAutoMode` arriving mid-session not moving an already-running auto-mode session back to default mode
19. Fixed a "switch to Opus 1M for 5x more context" tip that appeared even when the current Opus model already has a 1M context window
20. Fixed Claude apps gateway sessions treating a stored Anthropic profile (e.g. a Console sign-in) as active: listing it in `/status` and retrying gateway 401s with it, though requests never use it
21. Fixed cloud sessions telling Claude the model had changed when the host was only setting the session's initial model
22. Fixed Remote Control reporting a failure when an organization's policy disables it; it now shows a single quiet notice instead
23. Fixed `/mcp reconnect` on Remote Control showing a generic withheld-detail error instead of the real remedy when a server was disabled in another session
24. Fixed `--input-format stream-json`: client-injected assistant tool calls sent without a message id were merged into the first one and their results lost, including when resuming older sessions
25. Fixed session transcripts being silently overwritten when a directory change relocated a session onto an existing same-ID transcript
26. Fixed background sessions and their subagents being unable to edit files inside a git worktree they created with `git worktree add`
27. Fixed background sessions occasionally starting without any plugin skills (and staying that way) when another Claude Code process was refreshing the plugin marketplace at the same moment
28. Fixed selecting text in an opened background session inside tmux over SSH: it now copies to the tmux buffer like a foreground session instead of falling back to OSC 52
29. Fixed SDK and cloud sessions hanging indefinitely when an SDK MCP server's handshake acknowledgment was lost; the wait now times out after 70 seconds and marks only that server failed
30. Fixed self-hosted runner leaving a stuck session's Bash tool processes running after the session was force-stopped
31. Fixed `/usage-credits` for Team and Enterprise members whose admin set the org's usage-credit limit to $0: it now offers to ask the admin instead of saying a cap was reached
32. Fixed `--worktree --tmux` with a merge-request number on a gitlab.com origin trying a doomed GitHub-style fetch first instead of fetching the GitLab ref directly
33. Fixed Ctrl+G failing with "Emacs quit unexpectedly" in background sessions for editors that open `/dev/tty`, such as `emacs -nw` and `micro`
34. Fixed an `additionalDirectories` entry containing a null byte crashing startup, or breaking `/add-dir` and later settings updates when it came from an SDK host, IDE, or hook; it is now skipped
35. Fixed the MCP server menu's copy shortcut: it now says how the sign-in URL was copied instead of always claiming success
36. Fixed italic text (such as the session recap line) rendering as highlighted blocks in GNU screen and in tmux sessions using a `screen` terminal type
37. Fixed `claude mcp add --header` and `claude mcp add-json` help text naming the wrong transports
38. Fixed `claude ultrareview` and `/ultrareview` waiting the full 30 minutes when the cloud session fails to start; they now stop early and report the reason
39. Fixed Bash permission checks auto-approving commands that assign an arithmetic expression to an integer shell variable (e.g. `OPTIND=1/0`, `RANDOM=2+2`); these now prompt for approval
40. Fixed backgrounded sessions (`←`, `/background`, `--bg`) losing a Vertex/Bedrock gateway (`ANTHROPIC_*_BASE_URL` + `CLAUDE_CODE_SKIP_*_AUTH`) exported in the shell, so every request failed
41. Fixed `claude --bg --model fable` on Max plans stopping to ask for usage credits while the interactive session on the same account still had Fable allowance
42. Fixed the one-time "make auto mode your default" offer appearing in unattended sessions (e.g. agent-team teammate panes), where a stray keypress could accept it unread
43. Fixed the managed-settings approval prompt re-appearing after signing in again to the same Claude apps gateway when the settings are unchanged
44. Fixed disabled `/bug` and `/share` reporting that `/feedback` was disabled; tips, `/help`, and refusal messages no longer suggest `/feedback` when an org policy or env var turns it off
45. Fixed cloud session creation advising GitHub setup after a transient GitHub connection failure — the message now says to retry instead
46. Improved CPU usage during turns in interactive sessions by cutting redundant UI re-renders
47. Improved install size: the native binary is about 5 MB smaller
48. Improved cloud sessions: when the session's network proxy drops a connection during a Bash command, the tool result now names the host and reason instead of only "connection reset"
49. Improved `/schedule` to explain that MCP servers configured in Claude Code can't be attached to cloud routines, instead of a bare "No MCP connectors" message
50. Improved framing of messages from your own subagents: Claude is told the sender is a worker inside this session, not an unrelated Claude session
51. Improved the prompt placeholder to read "Message @name…" while viewing a background subagent or fork transcript opened from the subagent panel or `/tasks`
52. Improved sanitization of MCP server names in error messages, menus, and command results
53. Improved Amazon Bedrock session start under `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` (e.g. Claude Desktop): a session given a Bedrock model ID or ARN no longer waits for inference-profile discovery
54. Improved the managed settings approval dialog to list only the settings that changed since you last approved them
55. Improved retry when the model's tool call is malformed: the broken output is now dropped from the retry context, including on Bedrock, Vertex, and Foundry
56. Changed `/radio` to be available on Bedrock, Vertex AI, Foundry, and Claude Platform on AWS, and when telemetry is disabled
57. Changed Claude in Chrome so browser actions always go through Claude Code's permission checks, including in sessions with telemetry disabled, which previously used the Chrome extension's own prompts
58. Changed `CLAUDE_CODE_SUBAGENT_MODEL` to set the default subagent model rather than override everything: an agent definition's `model:` and an explicit per-spawn model now take precedence over it
59. Changed the default commit trailer to `Co-Authored-By: Claude Code` when the active model isn't a recognized Claude model (e.g. third-party models behind a custom `ANTHROPIC_BASE_URL`)
60. Changed the default model for seat-based Enterprise subscriptions to Opus 5, matching other premium plans
61. Changed `/effort` to save your default effort level per model, so each model keeps its own setting when you switch
62. Changed analytics to no longer turn off before sign-in solely because managed settings force gateway login (or cannot be read); they stay off once signed in to the gateway or via `DISABLE_TELEMETRY`
63. Changed the footer PR badge on Bedrock, Vertex, and Foundry, and when telemetry is off, to call the GitHub API directly (via `gh auth token`, `GH_TOKEN`, or `GITHUB_TOKEN`) instead of `gh pr view`
64. Changed how Bash command output files are created and read back when commands run in the sandbox, so a sandboxed command cannot redirect or replace them
65. Changed plugin/LSP install suggestions and the auto-mode default offer to wait until you've sent or cleared what you're typing, so the Enter that sends your prompt can't answer them
66. Changed server-managed settings that terminate sandbox TLS, route sandbox traffic through your own proxy, inject credentials, or weaken sandbox isolation to require approval before they apply
67. Changed `ANTHROPIC_CUSTOM_HEADERS` from managed or project settings to require approval when it sets a credential, org/tenant, routing, or API-behavior header (e.g. `Authorization`, `Host`)
68. Changed project-level `.claude/settings.json` `env` to no longer set `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_TMPDIR`, or `TMPDIR`/`TMP`/`TEMP`; set them in your shell, user, or managed settings instead
69. Removed syntax highlighting for six rarely used languages (1c, gml, isbl, mathematica, maxima, sqf); the binary is 2.5 MB smaller
70. [VSCode] Fixed the sign-in screen's "Bedrock, Foundry, or Vertex" button opening the docs at the top of the page instead of the third-party provider setup section
71. [VSCode] Changed the Remote Control banner to a footer pill (shown while Remote Control is on or has failed) that opens the session on claude.ai/code; turn it on or off with `/remote-control`

## 邻版（勿折入本 pack）

| 版本 | 官方 CHANGELOG |
| ---- | -------------- |
| **2.1.248** | 已收口（HAVE 47 / N/A 2）。本 pack 不回改 248 |
| **2.1.249** | **无此节**（跳号） |
| **2.1.250** | 1 条 stub：Bug fixes and reliability improvements |
| **2.1.252** | 4 条 hotfix（Bash swap / always-allow / RC stall / 大失败通知）。另包，不折入 |
