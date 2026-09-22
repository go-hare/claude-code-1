# densable 2.1.248 — Changelog

> 来源：GitHub/`CHANGELOG.md` **## 2.1.248**（2026-08-27）  
> Tag：[`v2.1.248`](https://github.com/anthropics/claude-code/releases/tag/v2.1.248) · raw：[CHANGELOG.md](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)  
> SEA：`@anthropic-ai/claude-code-win32-x64@2.1.248` 已下（`%TEMP%\official-248\package\claude.exe` **226708128** · `--version` **2.1.248**）。checklist/board 已开。changelog **只是索引**。  
> 口径：densable-first 1:1 · invent-ban · **只盘 248**（勿折入 249 空号、250 stub、251+）  
> 更新：2026-09-20 — SEA_OK。无函数体前不升 HAVE。不 invent `--restricted` / `experimental.cacheTtl` / 云宿主 / Desktop / VSCode。

## What's changed（官方原文 · 49 bullets）

编号跟 GitHub `CHANGELOG.md` **## 2.1.248** 原文顺序。

1. Added `--restricted` (or `CLAUDE_CODE_RESTRICTED=1`): removes the built-in tools that run commands or code and `WebFetch` (unless named in `--tools`), keeps file tools inside the working directory, refuses `bypassPermissions`, and ignores user, project and local settings files
2. Added `experimental.cacheTtl` (`"5m"` or `"1h"`) to agent frontmatter: a per-agent prompt cache TTL used when no subagent TTL setting is configured
3. Added `claude self-hosted-runner --client-label ` (or `SELF_HOSTED_RUNNER_CLIENT_LABEL`) to override the label the runner registers with (default: hostname)
4. Added server-managed settings diagnostics: a startup warning when the settings fail to load, and a `/doctor` and `/status` line explaining a load failure or why they weren't fetched (Bedrock/Vertex/third-party provider, custom `ANTHROPIC_BASE_URL`)
5. Added a warning in `/web-setup` when the GitHub CLI token lacks the `workflow` scope, since pushes to very large repositories can be rejected without it
6. Added `/usage-credits` for Enterprise organizations billed through AWS Marketplace, self-serve Enterprise, and Enterprise trials, so members can request a higher usage limit from their admin
7. Added cross-session messaging (`SendMessage` / `ListAgents`) between sessions on the same machine on Bedrock, Vertex, and Foundry, and when telemetry is disabled
8. Fixed a prompt-cache miss (and lost extended-thinking context) roughly once an hour in long sessions, caused by tool definitions being re-rendered after an OAuth token refresh
9. Fixed the `ScheduleWakeup` tool definition changing between a session and its `--resume` when the account had entered usage overage, causing a full prompt-cache miss on the resumed session's first turn
10. Fixed Claude Desktop and Cowork sessions disappearing after 30 days: the transcript cleanup now keeps desktop-written sessions while they are in the app (unless org policy manages retention); the new `desktopSessionCleanupPeriodDays` setting caps the exemption
11. Fixed being sent to the login screen when another Claude Code process held the token refresh lock while the session token had expired; the request now fails with a retryable error instead
12. Windows: Fixed the `claude agents` list not responding to the keyboard after detaching from a session, or when launched in a terminal tab left in win32-input-mode
13. Fixed the recommended Console sign-in in `/login` failing with an OAuth error before showing a sign-in URL on machines where it can't be used (for example when `ANTHROPIC_API_KEY` or an API key helper is set); it now falls back to the API-key sign-in
14. Fixed model names in `/model` and fast-mode switch notices to render as code, so suffixes like `[1m]` display literally instead of as a link
15. Fixed `claude agents` skipping the workspace trust prompt when the `CI` environment variable is set
16. Fixed `claude agents` crashing on launch when the PR-status cache held a malformed entry
17. Fixed agent view resurrecting a weeks-old background session after the machine was off: such a session now shows as stopped at its real end, and opening it asks before resuming its saved conversation
18. Fixed agent view sometimes opening an older conversation, and dropping the typed prompt, when starting a new session
19. Fixed `claude agents`: opening a stopped session that you already resumed in another terminal no longer starts a second process on that conversation; the row now says it is open in a terminal
20. Fixed `claude agents` and `claude rm` refusing to delete a session ("has commits that are not pushed anywhere") when its worktree branch was already merged into your checked-out default branch (e.g. local `main`) but not yet pushed
21. Fixed background sessions waiting silently when a `PermissionRequest` or `PreToolUse` hook prints an invalid answer: the `claude agents` row now names the hook and the schema error
22. Fixed hooks silently treating a stdout `{…}` object that isn't valid JSON as plain text; it's now reported as a hook error with the parse message
23. Fixed `/mcp` listing a project `.mcp.json` entry that declares the claude.ai connector type under the trusted "claude.ai" heading; it now appears under its real scope
24. Fixed MCP servers whose `headersHelper` supplies the `Authorization` header falling into OAuth discovery on a 401 instead of re-running the helper and retrying the call as documented
25. Fixed `/login` to a Claude apps gateway hanging when the managed-settings security approval dialog was required
26. Fixed gateway model discovery (`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`) never running when `apiKeyHelper` is the only credential
27. Fixed `claude logs` leaving mouse tracking, bracketed paste and the alternate screen switched on in the terminal it was run from
28. Fixed the trust dialog's list of repo permission rules showing a garbled character when a long rule was cut off in the middle of an emoji
29. Fixed the permission mode indicator staying hidden behind the "Press Ctrl-C again to exit" hint when you press shift+tab right after ctrl+c
30. Fixed `/ultrareview` and locally seeded cloud sessions uploading uncommitted edits to `prod.env`-style and `*.tfvars` files, or to editor swap, temp, and backup copies of credential files (e.g. `key.pem.tmp`, `id_rsa.swo`); they now stay on your machine
31. Fixed Remote Control sessions occasionally never showing a permission prompt or the latest messages on the connected device after the CLI silently reconnected
32. Fixed cloud sessions occasionally failing at startup when the container's session credentials were not yet readable
33. Fixed `claude remote-control` rejecting its own flags (e.g. `--spawn`, `--name`) when a global flag or a wrapper-injected option precedes the subcommand
34. Fixed startup warnings (e.g. "N MCP servers need authentication") rendering one column right of the rest of the transcript
35. Fixed a backgrounded worktree session losing its checkout: the background session now holds the worktree's lock while it runs, so cleanup and `git worktree remove` leave it alone
36. Fixed @-mentions of other sessions not matching names typed with non-Latin characters (for example Korean entered through an IME)
37. Fixed an invalid `crossSessionInbound` value being silently ignored: it now warns and holds cross-session messages (user settings) or refuses them (managed settings) until fixed
38. Fixed rate-limit, usage, and fast-mode messages telling you to run `/usage-credits` when that command isn't available for your organization (e.g. hidden with `DISABLE_EXTRA_USAGE_COMMAND`)
39. [VSCode] Fixed a chat tab getting stuck on "No conversation found" when its session was never saved; it now starts a new conversation instead
40. Improved the Workflow tool's prompt footprint: its description is now about 1k tokens instead of 5.7k, with the script-writing reference moved into a bundled `workflow-authoring` skill
41. Improved the prompt-footer PR badge to check GitHub less often while the pull request is unchanged; a push or a `gh pr` command still refreshes it right away
42. Improved managed settings: client-side timeout, MCP startup-mode, and stream-watchdog env vars no longer trigger the settings-approval prompt
43. Improved `/ultrareview <PR#>` to check before launch that the GitHub account connected to your Claude account can access the repository, and to explain how to fix it, instead of failing after the cloud session starts
44. Improved cross-session messaging: falls back to a private per-user `/tmp` directory when the default one can't be used, and the notice and `/status` name the directory to fix
45. Changed shift+enter in the agent view dispatch input to insert a newline (matching the prompt); ctrl+enter now dispatches and attaches
46. Changed `/loop`: self-paced dynamic mode and the no-prompt autonomous default are now always available, including on Bedrock/Vertex/Foundry
47. Changed Anthropic telemetry export failures to log at debug level as `[Anthropic telemetry]` instead of `[3P telemetry] OTEL diag error`, so they are not mistaken for your OTel collector failing
48. Changed cross-session messaging in Linux user namespaces: root-equivalent trust for unmapped owners is limited to canonical system directories
49. Changed `SendMessage` from a subagent to another session: the result now notes that any reply is delivered to the parent session's conversation, not to the subagent

## 邻版（勿折入本 pack）

| 版本 | 官方 CHANGELOG |
| ---- | -------------- |
| **2.1.247** | 已收口（HAVE 31 / N/A 2）。本 pack 不回改 247 |
| **2.1.249** | **无此节**（跳号，同 230 / 242 / 244） |
| **2.1.250** | 1 条："Bug fixes and reliability improvements"（无明细） |
| **2.1.251+** | 未开 |

## 247→248 字符串钉（SEA-first）

SEA 已下，`--version` **2.1.248**。首轮钉子：`snippets/gold-248-needles.txt`、`gold-248-gold.txt`。**无整条对齐不升 HAVE。** changelog 字面不是合同。本地 `/usage-credits`、`DISABLE_EXTRA_USAGE_COMMAND`、leftover `Cwn`/`GC`（`host.launchOptions.#w`）**不是** `#1` `Yk` / `#6` 整条。

相对 247 SEA **新出现、可当钉子**（窗口在 `gold-248-gold.txt`）：

| 钉子 | 对应 # | 金标 |
| ---- | ------ | ---- |
| `O2`/`Yk`/`D2n`；`--restricted` parse；`CLAUDE_CODE_RESTRICTED` | #1 | `gold-248-feat-1.txt` |
| `--restricted cannot be enforced in a cloud, remote-environment or ssh session` | #1 | 同上 |
| `mUt` / `jTt` `agent_frontmatter` / `experimental.cacheTtl` | #2 | `gold-248-feat-2.txt` |
| `ra` `--client-label` / `SELF_HOSTED_RUNNER_CLIENT_LABEL` | #3 | `gold-248-feat-3.txt` |
| `ISe`/`zre`/`Gmr`/`qgn` 3P+custom base URL | #4 | `gold-248-feat-4.txt` |
| `/web-setup` `F()` workflow present/missing | #5 | `gold-248-feat-5.txt` |
| `DN`/`Zur`/`v_` Marketplace+self-serve+trial | #6 | `gold-248-feat-6.txt` |
| `Po()` same-machine gate（`Ye()` 是跨机，勿混） | #7 | `gold-248-feat-7.txt` |
| `Ae`/`xe` `desktopSessionCleanupPeriodDays` | #10 | `gold-248-na-10-Ae.txt`（CLI sweep，不标 N/A） |
| `rr`/`or`/`ar`/`Ke` seed 滤（changelog 例不是字面） | #30 | `gold-248-na-30-*.txt` |
| `b`/`C`/`w`/`R` `allowUnknownOption` | #33 | `gold-248-na-33-*.txt` |
| `Fmr`/`gTt`/`T`；`pXt` 体禁自写 | #40 | `gold-248-na-40-*.txt` |
| `A$` + 304/`pollerNotModifiedStreak`（≠ 247 `Wut`） | #41 | `gold-248-na-41-*.txt` |
| `k`/`TUn`/`oae` `github_not_connected` | #43 | `gold-248-na-43-*.txt` |
| loop register 去 GB | #46 | `gold-248-na-46-register.txt` |
| `Oht`/`QO`；3P OTEL 前缀仍留 | #47 | `gold-248-na-47-*.txt` |
| `OAuthRefreshLockTimeoutError`/`Zye` | #11 | `gold-248-cache-verdict.txt` |
| `kxt`/`fallbackCures` Keyless Console | #13 | 同上 |
| `T()` `Me(!1)` CI 不再 skip | #15 | `gold-248-agents-*.txt` |
| `uXe`/`K$n`/`q$n` drop malformed PR cache | #16 | 同上 |
| `Open in a terminal` / `terminalHolderOf` | #19 | 同上 |
| `lIe` `{`+坏 JSON → validationError | #22 | `gold-248-cache-verdict.txt` |
| `su`/`c9n` helper 算凭证 | #26 | 同上 |
| `Pmr` logs 退出 | #27 | `gold-248-agents-*.txt` |
| `pGe`/`Gct` bg worktree lock | #35 | 同上 |
| `N()`/`invalidSetting` → **hold**（不 invent refuse） | #37 | `gold-248-cache-verdict.txt` |
| `v_()`/`Nde()` | #38 | 同上 |
| LEh STREAM_WATCHDOG + NONBLOCKING | #42 | 同上 |
| `Fs` `canDispatchAndOpen` ctrl+enter | #45 | `gold-248-agents-*.txt` |
| overflowuid / uid_map（≠ daemon `tsn`） | #48 | `gold-248-cache-verdict.txt` |
| `Pe()` parent 回复句 | #49 | 同上 |

禁止 invent 超出金标：

- `#1` 行为面按剥体，不按 changelog 加戏
- `#32` 云容器凭证（N/A）
- `#39` VSCode（N/A）
- `#40` `workflow-authoring` skill **正文**
- `#43` 云 ultrareview 启动路径
- `#16` leftover 宿主 `AgentView.refresh` + `fleetView/prStatuses.ts`（`V$n`/`Oo`/`KC` + `fleetRpMerge`/`updatePendings` + `setRemoteWanted`/`#I`/`loadRemote`（`Hu()`=`[]`，`Zs=!1`）+ uds `peerProtocol` 已接；不 invent 第二份 `Fh()`/`rp`/`Xw`/cloud list）
- leftover `LaunchOptions` 已接整份 official Ie（`Yk`/`c7e`/`KEn`/`YEn`/`AL`/`Rwn`/`Cwn`/`GC`）；leftover `SettingsSource`/`ExtensionsConfig` 已接 official Fe/Oe；leftover Session 已接 official `yGt`/`en`/`un`/`n()`（`avt()??Iq()` + `Se` scroll `Zt=150`）；leftover `o_`/`XFe` 走 `k.host.credentialSlots`；leftover `Gri`/`Vri` 走 `k.host.requestLatches`；leftover SessionRefsGate wrappers + /clear /resume flag clear 走 n() bags；不 invent Yt
- `#37` managed refuse（SEA 是 hold）
