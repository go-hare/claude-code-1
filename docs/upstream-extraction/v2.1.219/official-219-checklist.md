# densable 2.1.219 — 官方更新清单 × go-hare 对照

> 来源：官方 2.1.219 release notes（`changelog-2.1.219.md`，**24 条**）。  
> densable 二进制：`%TEMP%/official-219/package/claude.exe`（VERSION **2.1.219** HIT）。  
> 基线：产品 **2.7.33** / densable **2.1.218** 已收口；本 pack 对齐 **2.1.219**。  
> 状态：**GAP** · **PARTIAL** · **HAVE** · **N/A**  
> 约定：**extract densable first → 1:1**。不自动 commit/push/bump。  
> 更新：2026-08-08 — 24/24 HAVE（#14/#15/#1 本轮收口）。

## densable 关键符号


| 符号 / 字符串 | 含义 |
| --- | --- |
| `qPu=3` / `_ee()` / `tengu_hazel_trellis` | #24 nest depth default 3 |
| `NQ` / basename `bash.exe\|sh.exe\|bash\|sh` | #13 GIT_BASH path validate + warn fallthrough |
| `s2t` / `executeDirectoryAddedHooks` / `DirectoryAdded` | #3 DirectoryAdded hook |
| `strictAllowlist` on `SandboxNetworkConfigSchema` | #2 sandbox network deny without prompt |
| `mcp_server_errors` on stream-json init | #4 headless init errors |
| `workflowSizeGuideline` settings key + medium default | #5 / #18 |
| `claude-opus-5` / `Bl.opus5` / firstParty default opus | #1 Opus 5 |
| `Opus (1M context)` merged row | #10 picker label |
| `--forward-subagent-text` depth-2+ | #6 nested subagent stream |
| densable pv fallthrough opus-4-7 / 4-8 / 5 (not 4.6; changelog drop-4.7 conflicts binary) | #22 |
| `S7` / `VQr` / `Y6u` / `Hyy` / `X6u` | #19 MCP policy `${VAR}` |


---

## 全量对照（24 条）


| # | 官方条目（摘要） | 状态 | 本地备注 |
| --- | --- | --- | --- |
| 1 | Claude Opus 5 默认 Opus + 1M / fast $10/$50 | **HAVE** | GHt/Pji/Cig；C7n；**full EHl**→`densableEhlCatalog.219.ts`+SQ/Tig/NIc；LIc 硬编码；MODEL_COSTS+Uot；IGr/Tug opusplan version-agnostic |
| 2 | `sandbox.network.strictAllowlist` | **HAVE** | schema + `resolveSandboxStrictAllowlist` + ask-callback deny；deniedDomains merge |
| 3 | `DirectoryAdded` hook（`/add-dir` + SDK `register_repo_root`） | **HAVE** | `s2t` + slash_command wire + `register_repo_root` He/sxm + print handler |
| 4 | init `mcp_server_errors` + 终端 startup warn | **HAVE** | densable Tlr soft-skip + gEm/yEm store + TTY warn + QueryEngine init filter |
| 5 | settings `workflowSizeGuideline`；/config 有 settings 时隐藏 | **HAVE** | YNt hide + /config row + medium default + large=50 |
| 6 | stream-json nested depth-2+ `--forward-subagent-text` | **HAVE** | CLI flag + validate; QueryEngine/print/Tool options; AgentTool Tr reforward + full text progress; toolExecution parentToolUseID; normalizeMessage subagent_type/task_description; runAgent nest flag + async Yud/_Is writer |
| 7 | `claude -p` mid-stream API error 保留已出文本 | **HAVE** | claude.ts catch partial finalize (zie/Kie + watchdog + api_error); QueryEngine prior non-error assistant text for result |
| 8 | `mcp list` / `/mcp` HTTP status + error + whitespace warn | **HAVE** | FailedMCPServer.errorCode/displayDetail; fSp/mSp/pSp (`mcpConnectionIssue.ts`); ivp→list `status — issue` + get `Issue:`; `/mcp` failed row; reconnect Ujo; whitespace `jyy` 已有 |
| 9 | Fable “Requires usage credits” stale cache | **HAVE** | BUc/P5i/hug (`fableCreditsLabel.ts`); additionalModelOptionsCache merge 经 hug strip/reapply |
| 10 | `/model` merged Opus 行 “Opus (1M context)” | **HAVE** | `getMergedOpus1MOption` / getOpus47_1M / getMaxOpus47_1M 标签均为 densable `Opus (1M context)` |
| 11 | GNU screen copy-on-select base64 | **HAVE** | densable `$T` screen jCu=76 DCS chunk (`formatScreenOsc52Clipboard`); setClipboard STY branch |
| 12 | RC clients stale fast-mode after model switch | **HAVE** | densable Bcn `mde()`+MB：print set_model / bridge onSetModel / useReplBridge 均 clearFastModeCooldown + remote uU；org disable 仍经 onOrgFastModeChanged |
| 13 | `CLAUDE_CODE_GIT_BASH_PATH` bash/sh basename + warn | **HAVE** | `findGitBashPathOrNullWithDeps` densable NQ |
| 14 | Vim ← empty prompt NORMAL → agent view | **HAVE** | densable idle+!shift+(up\|down\|left&empty)→handleKeyDown；`shouldDelegateVimIdleArrowToTextInput` 纯 gate + e2e matrix；VimTextInput 透传 onLeftArrowOnEmpty* |
| 15 | screen-reader 每键重写整行 | **HAVE** | densable xuy+prevScreenReaderAnchor suffix-append；plan.suffixAppend 仅回显新字符 |
| 16 | RC only via api.anthropic.com 点名 setting | **HAVE** | densable x4_/dWr/YBo (`remoteControlEndpointReason.ts`); getBridgeDisabledReason early L8e gate |
| 17 | `--teleport` 显示 checkout repo mismatch | **HAVE** | densable Qvo：mismatch 抛 `This repo is ${currentDisplay}`；host 不同才 prefix host（teleport.tsx） |
| 18 | dynamic workflows 默认 medium（&lt;15 agents） | **HAVE** | large=50 densable；default medium |
| 19 | managed MCP allow/deny `${VAR}` 从 startup/managed env | **HAVE** | densable S7/VQr/Y6u/Hyy/X6u；deny Hyy fallback；allow Y6u only；startup freeze in apply*Env |
| 20 | `/model` 仅高亮最新模型名 | **HAVE** | densable ModelPicker `Wr` 不传 `highlightText`（避免 "Opus" 多行误高亮）；本地 Select 同；最新行 label=`Opus` / desc=`Opus 5` |
| 21 | running-workflow status 显示 default size + /config 指针 | **HAVE** | densable aEd/dLs on WorkflowTool prompt+description (`formatWorkflowSizeGuidelineToolSuffix`) |
| 22 | 移除 Opus 4.7 fast；`/fast` → Opus 5 + 4.8 | **HAVE** | densable `pv`：full EHl ON/Lqm/Oqm（Nqm 未赋值）；Tig from SQ.models；fast_mode 4-7/4-8/5 + string；Uot fable/mythos tier_10_50；`FAST_MODE_MODEL_DISPLAY=Opus 5` |
| 23 | claude-api skill 默认 Opus 5 + 4.8 migration | **HAVE** | `SKILL_MODEL_VARS` densable：OPUS→5 / PREV_OPUS→4.8 / SONNET→5 / PREV_SONNET→4.6 + SONNET_NEXT_* |
| 24 | nested subagents default depth 3（was 1） | **HAVE** | `DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH=3` / qPu |

