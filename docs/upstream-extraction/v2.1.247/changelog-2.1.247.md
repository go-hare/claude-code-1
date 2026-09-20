# densable 2.1.247 — Changelog

> 来源：GitHub/`CHANGELOG.md` **## 2.1.247**（2026-08-26）  
> Tag：[`v2.1.247`](https://github.com/anthropics/claude-code/releases/tag/v2.1.247) · raw：[CHANGELOG.md](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)  
> SEA：`@anthropic-ai/claude-code-win32-x64@2.1.247` 已下（`%TEMP%\official-247\package\claude.exe`，253204128）。相对 246 **+2.15MB**。  
> 口径：densable-first 1:1 · invent-ban · **只盘 247**（勿折入 248+；勿按 changelog 扩写 SendFeedback）  
> 更新：2026-09-17 — UNKNOWN 复剥。HAVE **29** / PARTIAL **0** / UNKNOWN **2** / N/A **2**。金标以已锁 SEA 函数体为准；changelog 是索引。  
> 更新：2026-09-19 — **本 pack 已收口**（HAVE **31** / N/A **2**）。未进 tip。不折入 248+。  
> 更新：2026-09-20 — 247 已入库，npm **2.7.50**。不折入 248+。

## What's changed（官方原文 · 33 bullets）

编号跟 GitHub `CHANGELOG.md` **## 2.1.247** 原文顺序。

1. Added the `SendFeedback` tool: when something goes wrong in a session, Claude can draft a feedback report for you to review and send from `/feedback` (turn off with the `feedbackDrafts` setting)
2. Added `{id, text, cooldownSessions, priority}` entries, `tipsFile`, and `label` to `spinnerTipsOverride`, so organizations can rotate their own tips alongside the built-in ones
3. Added a tip on Bash permission prompts pointing to auto mode, with a one-keystroke "Yes, and switch to auto mode" option
4. Added `/claude-api cost-optimize` to profile an existing project's Claude API spend and work through cost levers (caching, token hygiene, batch, effort, model choice) one measured change at a time
5. Updated the `/claude-api` skill with Admin API coverage (organization members, invites, workspaces, API keys, rate limit reports, workload identity federation, CMEK)
6. Fixed fast arrow-key + Enter sequences acting on the row above the one you navigated to in history search, `/config`, `/mcp`, `/skills`, background tasks, and `/model`
7. Fixed sub-agents dying on a first-call model 404: they now use the session's fallback model chain, and the error returned to the parent includes the error type, status, request id, and model
8. Fixed a hook or background agent that printed megabytes of error output being able to overflow the conversation and wedge the session on "Prompt is too long"
9. Fixed Ctrl keyboard shortcuts not firing under non-Latin (e.g. Cyrillic) keyboard layouts in kitty-protocol terminals
10. Fixed text like `<35;150;7M` being inserted into the prompt when a mouse report arrived split across reads right after the escape prefix
11. Fixed the Bash sandbox's after-command cleanup deleting a dotfile-managed `~/.claude/settings.json` symlink (nix/home-manager, stow) when it is repointed outside the sandbox's writable area
12. Fixed `/terminal-setup` overwriting your entire Zed `keymap.json` instead of merging in its keybinding
13. Fixed `/rename` silently confirming when the session registry could not be updated; it now says other sessions may still show the old name
14. Fixed `/compact` and "Summarize from here" in sessions started with `--agent` summarizing under the default system prompt instead of the conversation's own
15. Fixed a background session showing "opening…" forever in `claude agents` after its terminal host process died; the row now fails within seconds with the reason, and Enter restarts it
16. Fixed unbounded memory growth when a hook's or background task's output file could not be written; the file now notes where output was lost
17. Fixed `/install-github-app` over SSH: the copy shortcut now says how the sign-in URL was copied instead of always claiming success, and the URL appears immediately when no browser can open
18. Fixed shell commands carried over from the foreground logging an internal error or showing a misleading `[exited with code -1]` line when they finish in background sessions
19. Fixed a version-less marketplace plugin's live cache directory being deleted and recreated on a second-scope install, which could disrupt a running session using it
20. Fixed Remote Control sessions started with `/remote-control` not reporting the working-tree diff to connected clients
21. Fixed self-hosted runner sessions reporting `running` before Claude Code had started, which could trigger a premature "Claude is waiting for your input" notification from the Claude desktop app
22. Fixed first-run setup exiting with "Unable to connect to Anthropic services" when managed settings configure Claude apps gateway sign-in and Anthropic endpoints are unreachable
23. Fixed cloud sessions (Claude Code on the web, desktop and mobile apps) sometimes showing the previous permission mode when you switch modes right after sending a message
24. Fixed cloud sessions going silent when the session's container restarts between turns while a background agent, shell, or monitor is still running — the resumed session now reports the lost work
25. Improved plugin marketplace hardening: names containing control or invisible characters are rejected, and marketplace-supplied text in `/plugin` and `claude plugin` output is escape-safe
26. Improved Bedrock, Vertex, and Foundry sessions (and any with telemetry disabled): Claude is now told when a configured MCP server failed to connect, instead of concluding its tools don't exist
27. Changed Sonnet 5's default auto-compact window to its full 1M context, so sessions on the 1M window now auto-compact at about 967K tokens instead of about 934K
28. Changed cross-session peer messages to collapse by default to a one-line `Message from @: ` preview; Ctrl+O expands the full body
29. Changed terminal hyperlinks in rendered markdown: link targets that point at a network or automounter path, contain a control character, or lead with an invisible character now render as plain text
30. Changed the prompt-footer PR badge to skip its GitHub re-check on terminal refocus when the last check is under a minute old
31. Changed analytics to stay off from startup, not only after login, when managed settings force gateway login or a custom OAuth deployment is configured
32. Changed Claude apps gateway sign-in requests to identify Claude Code (a `surface=claude_code` device-authorization parameter and a `claude-code/` User-Agent)
33. Changed organization sign-in enforcement to exit at start when the administrator's managed settings cannot be read, even if host-supplied or per-user Windows registry settings exist

## 邻版（勿折入本 pack）

| 版本 | 官方 CHANGELOG |
| ---- | -------------- |
| **2.1.246** | 已收口（HAVE 59 / N/A 2）。本 pack 不回改 246 |
| **2.1.248+** | 未开。`--restricted` 等一律不折入 |

## 246→247 字符串钉（SEA-first）

changelog 字面不是合同。相对 246 SEA **新出现**、可当钉子的：

| 钉子 | 对应 # | 金标 |
| ---- | ------ | ---- |
| `tipsFile` / `org-tip:` / `org-tip:file:` / `nt`/`rt`/`Ne`/`Ae`/`v` | #2 | `snippets/gold-spinner-tips-fn.txt` |
| `cost-optimize` | #4 | `snippets/gold-cost-optimize.txt` |
| `Admin API` / `CMEK` | #5 | `snippets/gold-admin-api-cmek.txt` |
| `still show the old name` / `registryUpdated` | #13 | `snippets/gold-rename-old-name.txt` |
| `host process died` / `EHOSTDEAD` | #15 | `snippets/gold-host-process-died.txt` |
| `surface=claude_code` | #32 | `snippets/gold-surface-claude-code.txt` |

**不是 247 NEW（246 SEA 已有同串）：**

- #1 `SendFeedback` / `feedbackDrafts` — 247=246 字节同体（`ee`/`Oe`/`Le`/`ot`/`Ps`）。changelog 超卖。**禁止 invent。** `gold-1-verdict.txt`。
