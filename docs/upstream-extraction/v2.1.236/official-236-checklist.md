# densable 2.1.236 — 官方更新清单 × go-hare 对照

> 来源：GitHub release **v2.1.236**（2026-08-19）+ densable SEA darwin-arm64。  
> SEA：`/tmp/official-236/plat/package/claude` · `2.1.236 (Claude Code)` · size **317044624** · sha256 `6bc4ba992d2786cbf0237c4453ca53c1fdf0c3b3d83ffa0025c0d8190ed27848`。  
> 基线：本地 tip densable **2.1.235** + npm **2.7.45**。**本 pack 只对齐 2.1.236**（勿折入 237）。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A**  
> 更新：2026-08-20 — Batch A/B/C **落地**；`#17/#22/#26` **HAVE**；gold-weak `#18/#24/#31/#32` → **PARTIAL**；GAP **0**。口径：**加强升档 + 其余与 SEA 1:1**。**无 auto commit/bump**。

## Summary

| 状态 | 计数 | 备注 |
| ---- | ---- | ---- |
| **HAVE** | **18** | Batch A/B + Batch C `#17/#22/#26` |
| **PARTIAL** | **14** | 含 gold-weak `#18/#24/#31/#32` |
| **GAP** | **0** | — |
| **N/A** | **1** | #33 VSCode host a11y（invent-ban） |
| **UNKNOWN** | **0** | — |

## Checklist

| # | key | 官方要点 | 状态 | 证据 |
| - | --- | -------- | ---- | ---- |
| 1 | ANTHROPIC_DEFAULT_MODEL | Added `ANTHROPIC_DEFAULT_MODEL` env: new-session start model; `/model` still overrides+persists (unlike `ANTHROPIC_MODEL`) | **HAVE** | tip `resolveAnthropicDefaultModelEnv` + org→env→tier + badge/`model_env_default`/allowlists/BYOC scrub（Batch A） |
| 2 | notify_when_idle | `notify_when_idle` on cross-session SendMessage — one-shot idle notice (macOS/Linux) | **HAVE** | tip `udsIdleNotify` + SendMessage schema/prompt/`subscribeToPeerIdle` + Kur=32（Batch B；`udsIdleNotify.236` 17 pass） |
| 3 | sandbox-wildcard-deny | Sandbox macOS: wildcard read-deny (e.g. `**/.env`) precedence inside allowed read regions | **HAVE** | tip `denyRead`/`allowRead` + sandbox-runtime wildcards / `**/.env*` |
| 4 | cwd-removed | Fixed clipboard/bg housekeeping/bg sessions/local MCP logs after switched-into dir removed | **PARTIAL** | tip Shell cwd recovery + `mcp-logs-*` cleanup 在；236 全套路径未逐条锁死 |
| 5 | fullscreen-fallback | Fullscreen renderer: single failed start → fall back to classic instead of permanent exit | **HAVE** | tip `fullscreenBootPending`/`crashAutoOff`/canary FSM + `/tui` FJi + `replLauncher` `$Ji`（Batch B；`fullscreenBootCanary.236` 绿） |
| 6 | model-picker-height | `/model` picker taller-than-terminal: show only fitting rows + scroll | **PARTIAL** | SEA `LFh=14`。tip `ModelPicker.tsx` 固定 `maxVisible = 10` |
| 7 | sendmessage-malformed-tag | SendMessage rejected when malformed closing tag left text in summary | **PARTIAL** | tip summary coerce/truncate（Cpr=200）+ slipped-summary 测试；SEA「malformed closing tag」短语弱 |
| 8 | subprocess-unhandled | Unhandled rejection when subprocess fails to start (e.g. powershell on WSL) | **HAVE** | tip Ink/exec 已吞 spawn fail；SEA powershell/WSL + unhandledRejection 面匹配 |
| 9 | fullscreen-resize-message | Fullscreen: newly sent message missing until next update after resize | **PARTIAL** | tip FullscreenLayout / VirtualScroll / ink resize；SEA `replayPending`/`tickPump` tip 未对齐 |
| 10 | fullscreen-blank-band | Fullscreen: blank band after clearing multi-line prompt; panes not repainting | **PARTIAL** | tip fullscreen/ink repaint 面在；SEA latin1 金标弱 |
| 11 | managed-settings-prompt | Managed-settings approval prompt missing at startup while still eating first keypress | **PARTIAL** | tip ManagedSettingsSecurityDialog + remoteManagedSettings；吞首键修复未锁死 |
| 12 | tmux-title | tmux/iTerm title jump: write title only when text changes (was every 960ms) | **HAVE** | tip `use-terminal-title.ts` `useEffect([title, writeRaw])` 已 change-gated |
| 13 | cloud-env-empty | Unclear error when cloud environments list empty/malformed | **HAVE** | tip `mapMalformedEnvironmentsResponse` + loose DIS + empty `[]` OK（Batch B `wyvhenvgr`） |
| 14 | fable5-credits-rc | Fable 5 first-time usage-credits prompt auto-selecting fallback after 60s under Remote Control | **HAVE** | tip parkTimeout → `unanswered`/`dialog_unanswered`+`shouldAbort`，无 fallbackModel；soft cancel 仍可 `dialog_declined`（Batch B）；`dialog_queued_at_park`（J1t/xo park watch）已补；Fo/Wlt residual |
| 15 | guest-pass-malformed | Spinner tips never appear when guest-pass reward in ~/.claude.json malformed | **HAVE** | tip `referrerRewardSchema` + `getCachedReferrerReward` safeParse→null（Batch A） |
| 16 | skills-hot-reload-cwd | Skills hot-reload error after session cwd deleted (SDK/VS Code; 2.1.229+) | **HAVE** | tip `skillChangeDetector` `getFingerprint().catch(() => null)` 吞 cwd/ENOENT |
| 17 | self-hosted-runner | Self-hosted runner: idle/retire/startup-timeout release resumes elsewhere before post-session hook done | **HAVE** | tip Bxy/etu inFlight + ordered idle release after task/post-session + Forced shutdown/budgetMsg Ttu + `CLAUDE_RUNNER_CLIENT_PLATFORM`（`postSessionInFlight.236`） |
| 18 | clawd-eyes | Clawd mascot eyes/feet uneven in iTerm2 at some font sizes | **PARTIAL** | SEA hit `found:false`（gold-weak）；tip 仅 `Apple_Terminal` 分支 + half-block eyes；不 invent iTerm2 字号修复 |
| 19 | recap-cap | Recap runaway: cap at 400 chars, word boundary (auto + `/recap`) | **HAVE** | tip `truncateAtWordBoundary` + Hbm=400 on awaySummary/generateRecap（Batch A） |
| 20 | startup-session-counter | Startup: session counter written in background | **HAVE** | SEA 与 tip 均为 sync `numStartups+1` + `setImmediate` 遥测（`main.tsx` 注释与 SEA 金标一致） |
| 21 | auto-mode-monitor | Auto mode: Monitor allow rules set aside so Monitor reviewed like Bash | **HAVE** | tip `isBroadRule('Monitor', …)` set-aside（Batch A） |
| 22 | auto-mode-bedrock-defaults | Auto mode on Bedrock/Vertex/Foundry + telemetry-off: classifier same defaults incl severity-scored | **HAVE** | tip Gdu/`DO_NOT_TRACK` + KIt（3P/telemetry-off/DISABLE_GROWTHBOOK）+ KD→qTa `severityByModel` + yoloClassifier thresholds（`autoModeKdQta.236`） |
| 23 | status-showUntrackedFiles | Auto mode git status not fooled by status.showUntrackedFiles=no | **HAVE** | tip always `--untracked-files=normal|all`（Batch A） |
| 24 | model-picker-highlight | `/model` highlight only newest model name | **PARTIAL** | SEA hit `found:false`（gold-weak）；tip ModelPicker 无「只高亮最新名」可锁合同；invent-ban |
| 25 | goal-idle-checkin | `/goal`: idle+parked behind bg work auto check-in 30m then 1h/2h | **PARTIAL** | tip 固定 30m。SEA `t*2**Math.min(checkinCount,jsv)`（`jsv=2`）→ 30→60→120 |
| 26 | usage-credits-row | `/usage` usage-credits spend row for Team/Enterprise; capped 0% before spend | **HAVE** | tip iXl gate team\|enterprise + `Usage credits` + util clamp 0% + `formatUsageCreditsAmount`/`am` currency（Batch C） |
| 27 | sigterm-print | SIGTERM print/SDK: no interrupted-turn / synthetic denials; still kill cmds + exit 143 | **PARTIAL** | tip SIGTERM→abort+`gracefulShutdown(143)` HAVE；interrupted-turn / synthetic denial 清理未完全对齐 |
| 28 | slash-typo-enter | Enter on slash typo/unavailable reports instead of closest fuzzy; prefixes/aliases still run | **PARTIAL** | tip 不自动跑最近模糊 + 报 unknown；SEA 式 Did you mean 建议弱 |
| 29 | rc-offline-seconds | Remote Control marks session offline within seconds on CLI/terminal exit | **PARTIAL** | tip bridge shutdown deregister 在；「数秒内」量化未证 |
| 30 | sendmessage-burst | SendMessage refuses further msgs once burst would exceed inbox (no false sent) | **HAVE** | tip `udsOutboundPacer` T5d/`sentInBurst` + `udsClient` reserve-before-send + x5d（Batch B；`udsOutboundPacer.236` 绿） |
| 31 | title-chip-align | Session title chip aligned with footer right edge | **PARTIAL** | SEA hit `found:false`；tip StatusLine/session title 在，无 footer 右缘对齐金标；invent-ban |
| 32 | footer-right-margin | Right-aligned footer items + truncated notices share consistent right margin | **PARTIAL** | SEA hit weak；tip PromptInputFooter 散落 `paddingRight={1}`；无统一 right-margin 合同；invent-ban |
| 33 | vscode-a11y | [VSCode] transcript screen reader: live announcements + per-turn heading nav | **N/A** | invent-ban：VSCode 宿主 a11y；本仓 CLI 不对齐 host live region |

## GAP 优先（剩余）

— none —（Batch C 收口完成）

### Done → HAVE
Batch A: `#1` `#15` `#19` `#21` `#23`  
Batch B: `#13` `#14` `#5` `#30` `#2`  
Batch C: `#17` `#22` `#26`（`#18/#24/#31/#32` → PARTIAL gold-weak）

## 本轮相对初稿的加强

| # | 旧 → 新 | 依据 |
| - | ------- | ---- |
| 14 | PARTIAL→HAVE→**GAP** | 对齐官方：60s abort 仍走 `cancelled`→`dialog_declined`→自动切 fallback（`wuotfrf0f` 复核） |
| 15 | PARTIAL → **GAP** | tip 无 SEA `safeParse(referrer_reward)` |
| 16 | PARTIAL → **HAVE** | tip fingerprint `.catch(() => null)` |
| 17 | PARTIAL → **GAP** | release 仍可早于 post-session |
| 18 | PARTIAL → **GAP** | 无 iTerm2 专用修复 |
| 22 | PARTIAL → **GAP** | tip 无 telemetry-off / 多 provider 默认对齐证据 |
| 24 | PARTIAL → **GAP** | 无 newest-only highlight |
| 26 | PARTIAL → **GAP** | ExtraUsage 仅 Pro/Max |
| 31 | PARTIAL → **GAP** | 无 title-chip↔footer 对齐证据 |
| 32 | PARTIAL → **GAP** | 无统一 right-margin 证据 |
| 20 | 维持 **HAVE** | 与 SEA 同为 sync counter + setImmediate 遥测（Batch B 误判为 GAP） |

## Invent-ban

- 不 invent #33 VSCode 宿主 a11y / gateway / Desktop·cloud handoff / storageV5
- 不自动 commit / bump / push
- 不折入 **2.1.237**
- musl packaging residual 不在本 pack，除非 236 SEA 明确改动

## 工件

- snippets: `docs/upstream-extraction/v2.1.236/snippets/hit-*.txt`
- dig summary: `snippets/remaining-dig-summary.json`
- board: `boards/alignment-236.md`
- progress: `progress.md` · artifact `artifacts/alignment-236-progress.md`（hash `weO9IlabzJ3jmpy4FgN_U`）
