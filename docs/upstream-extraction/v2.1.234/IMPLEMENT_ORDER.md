# densable 2.1.234 — 落地顺序

> 配合 `official-234-checklist.md`。Binary SEA 金标优先。不 invent cloud/gateway/Desktop。  
> 更新：2026-08-18

## P0（产品语义 / 已确认 SEA）

| 序 | # | 项 | 状态 | 备注 |
| -- | - | -- | ---- | ---- |
| 1 | 47 | 移除 Default teammate model | **HAVE** | Config + `teammateModel`；legacy unread |
| 2 | — | Sticky React #185 1:1 jpw/Wrn | **HAVE** | 非 changelog；防 MessagesBoundary |
| 3 | 1 | `CLAUDE_CODE_PROJECT_DIR_NAME` | **HAVE** | SEA `T6c`/`XLe`/`bws`/`ify`; portable + memo getProjectDir |
| 4 | 2 | `selection:clear` | **HAVE** | SEA `h8i`；Scroll + AgentView `AgentsSelectionChrome` |
| 5 | 46 | Agent 下去掉 Allowed-by-auto 行 | **HAVE** | SEA `rrt.name!==di`；UserToolSuccessMessage |
| 6 | 45 | Esc 不清 mouse selection | **HAVE** | densable `bvh`/`Jew` 1:1；escape/page/ctrl+home|end |

## P1（高频 TUI / 权限）

| 序 | # | 项 | 状态 | 备注 |
| -- | - | -- | ---- | ---- |
| 7 | 4 | `autoContinueAtUsageLimit` | **HAVE** | Config + state machine + rate-limit + Esc + oTl tick |
| 8 | 18–20 | `!` shell / queue / history / Esc | **HAVE** | #18 DWS；#19 NMt/mode；#20 LI/na/Io/Ne/F3i/Vag/SQw/$l + historyEntry/JDr；`lte`=KB_COHESION_FIXES；`ke` paste-remap residual |
| 9 | 21–22 | fullscreen/`/tui` relaunch argv carry | **HAVE** | Cmt/Rmt/W4e/UYh + iyt/nfo/Zpc + xve flush + upsell/panel AppState carry；BYh bounce UI optional |
| 10 | 36 | user prompt markdown | **HAVE** | j3i/jh promptMode + z6m lean lexer + V3i truncate object + Divider titleAlign |
| 11 | 43 | goal check-in minutes | **HAVE** | wPv/iYp/APv/kPv/DMv；`goalCheckin.ts` + stopHooks；env `CLAUDE_CODE_GOAL_CHECKIN_MINUTES`（SPv=30） |

## P2（安全 / MCP / 文案）

| 序 | # | 项 | 状态 | 备注 |
| -- | - | -- | ---- | ---- |
| 12 | 6 | `\??\` 剩余预批准面 | **HAVE** | Jw/su/Yhe/s7t/lMp/k0c/dvr/gno 预批准面；automount `bu` 仍 SEA stub |
| 13 | 13–14 | MCP diag secrets / marketplace SCP host | **HAVE** | #13 Gpi/cHr/Ujo/McE；#14 pTt/I8s/zAd/WAd/JAd；verifier PASS |
| 14 | 28–29 | permission preview mask | **HAVE** | VKc tAt/pp/Lhy/zhy/$hy；truncateForPreview→tAt；verifier PASS + spot-check |
| 15 | 34 | ListAgents incomplete-list copy | **HAVE** | Gff/wWr/iza/CSf + searchTruncated；ListAgents/SendMessage；qGv budget 5 |
| 16 | 37 / 44 / 51 | API error / setup-token / win RO config | HAVE | done prior segment |
| 17 | 9 / 11 / 12 / 16 / 5 | content heal / SendMessage to max / git userinfo / HR / email identify | **HAVE** | KKn + Agf=300 + Aoe + `---\\n` + UPb userEmail |
| 17b | 7 / 8 | auto network session hosts / bg subagent session permission persist | **HAVE** | #7 wkr/LOr/sessionAllowedHosts；#8 y8r/m4n/n3e session setter |
| 17c | 10 | Markdown unusual Unicode 极慢 | **HAVE** | CXr PPE/DPE/d0l/uq/j6m.table；非 Bun.markdown |
| 17d | 35 | 过期 profile → `/login` | **GAP** | 需整栈 `A5`/`M$o`/`uD`/`z_`/`oRr`；无栈不 invent stub；见 `_peel_35_notes.md` |
| 17e | 41 | mid-turn fullscreen dialogs | **HAVE** | ARt/Ns/X3e/RVr；advisor+autocompact local-jsx；`autoCompactWindow`；见 `_peel_41_notes.md` |
| 18 | 42 | `/goal` 不可恢复错误自清 | **HAVE** | pXp/LMv/K1a；Terminal api_error；REPL runTurn finally；onActiveGoal |
| 19 | 48 | 运行中工具 header 耗时 dim | **HAVE** | u5e/ShellTimeDisplay 已 1:1 |
| 20 | 15 | fullscreen 模态复制丢字 | **HAVE** | y8i lastCopied + clipboard_write + ctrl+c cache |
| 21 | 3 | GitLab MR badge footer/statusline | **HAVE** | `_pp`/`lpp` glab fallback；无 yWb harbor_prism |

## N/A（跳过）

#25, #30–#33, #50

## 验证

每项落地后：对应单测 + 必要 SEA peel 笔记；阶段收口跑 `bun run precheck`（用户要求提交前必过）。
