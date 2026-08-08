# densable 2.1.217 — 官方更新清单 × go-hare 对照

> 来源：官方 2.1.217 release notes（`changelog-2.1.217.md`，**20 条**）。  
> densable 二进制：`%TEMP%/official-217/package/claude.exe`（`npm pack @anthropic-ai/claude-code-win32-x64@2.1.217`，**259 460 768** bytes；VERSION **2.1.217**）。  
> 基线：产品 **2.7.31** / densable **2.1.216** 已收口（`ffdb9806`，HAVE 38 / N/A 1）。  
> 状态图例：**GAP** 未对齐 · **PARTIAL** 有半截 · **AUDIT** 需再判 · **HAVE** 已有 · **N/A** 不适用 · **LOW** 可选  
> 约定：**extract densable first → 1:1**，禁止简化版替代。KAIROS 不再加码；UDS/LAN/TEAMMEM 默认 OFF。

## 邻版关系

| 版 | 性质 | go-hare |
|----|------|---------|
| **2.1.216** | 长会话/sandbox/worktree/bg/UI 大包 | **已收口**（2.7.31） |
| **2.1.217** | emoji / caps / brace budget / hyperlink / tips / bg 可靠性 | **本清单** |
| **2.1.218+** | 后续 | **另开 pack** |

---

## densable 关键符号（抽样）

| 符号 / 字符串 | 含义 |
|---------------|------|
| `emojiCompletionEnabled` + schema describe `:emoji: shortcode typeahead` | 设置项 + Prompt 补全 |
| `vBg=20` / `$vu()=Z.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS??vBg` | 并发 subagent 默认 20 |
| `Evu=1` / `Bue()` / `tengu_hazel_trellis` | 嵌套深度默认 1（env 优先，GB 次之） |
| `takeConcurrencySlot` / `subagent_concurrency_cap` | 运行中并发槽 |
| `subagent_depth_cap` / nesting limit message | 嵌套拒绝文案 |
| `Brace pattern expansion exceeds the budget; using it unexpanded` | paths frontmatter brace 预算 |
| `FORCE_HYPERLINK` | 强制/关闭 OSC8 |
| `maxImpressions` + `frontend-design-plugin` | tip 终身展示上限 |

---

## 全量对照（20 条官方）

| # | 官方条目（摘要） | 状态 | 本地备注 |
|---|----------|------|----------|
| 1 | emoji shortcode autocomplete + `emojiCompletionEnabled` | **HAVE** | densable `bZo` 1567 shortcodes + `NtS`/`OtS`/`LGa`/`WtS`/`GtS`；settings + `useTypeahead` |
| 2 | transcript write fail / session saving off 警告 | **HAVE** | densable `Gsn`/`x0t` + writer health ENOSPC；`sessionPersistenceStatus` + `transcriptWriterHealth` + REPL notifs |
| 3 | MCP truncate 不保留完整未截断结果 | **HAVE** | densable `Qmu`/`Jmu` persist 后返回 `{...e,content:a}`；本地 `maybePersistLargeToolResult` 同形；`processMCPResult` persist 后返回 instructions 字符串（非 full buffer） |
| 4 | Windows auto-update 失败恢复 preserved `claude.exe` | **HAVE** | `nativeInstaller/installer.ts` Windows restore 路径 |
| 5 | bg session isolation canonicalize 符号链接 cwd | **HAVE** | densable `hsr`/`a9u`/`XNe`/`N6g`/`T_s`/`tKr`/`Cco`/`l9u`/`VRu`/`qRu`/`F6g`/`Uyi`/`ZRu`/`GZe`；`bgIsolationContainment` 全量 8-hop/device-ns/trailing-dot/8.3 + FileWrite(e7)/FileEdit(e12)/NotebookEdit(e12)；`ToolUseContext.agentWorktree` + runAgent pin；`T_s` env→jobDir state→settings；gate `bg\|\|CLAUDE_JOB_DIR\|\|session`；Shell stack：`context_lost`（p&&!GZe）→ worktree_gone → VRu/qRu → bash-only ZRu AST（pure-TS U5e/`parseForZRu` + nKr） |
| 6 | Opus 4.8 Bedrock auto-compact + `/compact` over limit | **HAVE** | densable catalog `claude-opus-4-8` native_1m/supports_1m_beta；`modelSupports1M`+canonical+configs.opus48；Bedrock id `us.anthropic.claude-opus-4-8` → 1M window |
| 7 | Desktop mTLS/TLS/OAuth scope/proxy | **HAVE** | `managedEnvConstants` HOST_* + mTLS/proxy strip |
| 8 | screen reader 启动播报 + thinking status 行重渲染 | **HAVE** | densable `Yqc`/`Xqc`/`qXn`/`srStartupQuietTimer`；`screenReaderStartupQuiet` + Ink `onRenderScreenReader` gate；banner 后 `markScreenReaderStartupQuietStart`；mug=3000/hug=600000/`CLAUDE_AX_STARTUP_QUIET_MS` |
| 9 | managed `OTEL_EXPORTER_OTLP_ENDPOINT` 统管所有 signals | **HAVE** | densable `dTd`/`tdr`；`applyManagedOtelEndpointSupremacy` + applySafe/applyConfig 在 policy Object.assign 后调用；signal ENDPOINT 被 delete |
| 10 | resume TypeError on malformed attachment | **HAVE** | densable `nXu`/`dQr`；`isValidAttachmentPayload` + `dropMalformedAttachments` + resume 日志 |
| 11 | RC late-join viewer 看 pending permission/dialog | **HAVE** | RemoteSessionManager + sdkReinitRedelivery |
| 12 | bg shell 无法 stop（Windows 重） | **HAVE** | densable absolute `System32\\taskkill.exe` `/PID /T /F` + `windowsHide`；本地 `treeKillNoFlash` 1:1 |
| 13 | paths frontmatter brace expansion budget | **HAVE** | `frontmatterParser` G6c/Qug 1:1：Xug=1000 / Jug=4MB；超限 warn unexpanded |
| 14 | attach 中 bg transcript 与 input 一行 gap | **HAVE** | densable `zgb` footer `u=["",c,b6p,c,Ngb]`；`attachTranscriptPreview` footerLines 前导 `''` |
| 15 | footer PR badge 始终 hyperlink；`FORCE_HYPERLINK=0` 退出 | **HAVE** | `supports-hyperlinks.ts` FORCE_HYPERLINK parseInt===0→false；else force |
| 16 | login-expiry 警告 3 天（原 5） | **HAVE** | densable `mAr`/`lKp=3*cKp`；`oauthLoginExpiry` + `useOauthExpiryNotification`；persist `refreshTokenExpiresAt` |
| 17 | frontend-design tip 终身最多 3 次展示 | **HAVE** | densable `maxLifetimeShows:3` + `tipLifetimeShownCounts`/`Svr`/`O5o`；`frontend-design-plugin` |
| 18 | concurrent subagents default **20** / `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` | **HAVE** | `sessionSpawnCaps` `$vu`/vBg=20 + `takeConcurrencySlot` + AgentTool B()/P() 1:1 |
| 19 | nested subagents default off；`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`（默认 1） | **HAVE** | `Bue`/Evu=1 + hazel_trellis GB；`assertSubagentDepthAllowed`；child depth/spawnDepth |
| 20 | `--max-budget-usd` 停止 bg subagents（拒新 + halt 运行中） | **HAVE** | densable `Hrr`/`$am`/`iSe`/`tcr`；`budgetHalt` + AgentTool deny + print drain halt |

---

## 统计（Batch A + B + C 收口）

| 状态 | 条数 | 说明 |
|------|------|------|
| **HAVE** | **20** | #1 · #2 · #3 · #4 · #5 · #6 · #7 · #8 · #9 · #10 · #11 · #12 · #13 · #14 · #15 · #16 · #17 · #18 · #19 · #20 |
| **GAP** | **0** | — |
| **PARTIAL** | **0** | — |
| **AUDIT** | **0** | — |
| **N/A** | **0** | — |
| **合计** | **20** | |

> **Batch A（P0 安全阀 / caps）**：#18 concurrent · #19 spawn depth · #13 brace budget · #15 FORCE_HYPERLINK → **已落地**  
> **Batch B（产品 UX）**：#1 emoji · #17 tip lifetime · #16 login 3d → **已落地**  
> **Batch C（可靠性）**：#2 · #3 · #5 · #6 · #8 · #9 · #10 · #12 · #14 · #20 → **已落地**

---

## Batch A 落地映射

| # | densable | 本地 |
|---|---------|------|
| 18 | `$vu`/vBg=20 · `takeConcurrencySlot` · `subagent_concurrency_cap` · amber_kestrel / ultracode bypass | `src/utils/sessionSpawnCaps.ts` + `AgentTool.tsx` + `runAsyncAgentLifecycle.onRunSettled` |
| 19 | `Bue`/Evu=1 · `cN` · `subagent_depth_cap` · `tengu_hazel_trellis` | 同上 + `SubagentContext.depth` / task `spawnDepth` |
| 13 | `yJn`→`G6c`/`Qug` · Xug=1000 · Jug=4194304 | `src/utils/frontmatterParser.ts` |
| 15 | `FORCE_HYPERLINK` in `supportsHyperlink` / densable `Slt`/`WH` | `packages/@ant/ink/src/core/supports-hyperlinks.ts` |

### 推荐实施批次（续）

### Batch B — UX

5. emoji shortcode typeahead + setting  
6. frontend-design `maxImpressions: 3` lifetime  
7. login expiry 3 days  

## Batch B 落地映射

| # | densable | 本地 |
|---|---------|------|
| 1 | `emojiCompletionEnabled` · `bZo` · `NtS`/`OtS` · `LGa`/`WtS` · `GtS` · LtS=20 | `src/utils/emoji/*` + settings schema + Config UI + `useTypeahead` |
| 16 | `mAr` · `lKp=3*cKp` · `refreshTokenExpiresAt` · login expires copy | `src/utils/oauthLoginExpiry.ts` + `useOauthExpiryNotification` + OAuth persist |
| 17 | `maxLifetimeShows:3` · `tipLifetimeShownCounts` · `O5o`/`Svr` · Joi filter | `tipHistory`/`types`/`tipRegistry` + `GlobalConfig.tipLifetimeShownCounts` |

## Batch C 落地映射

| # | densable | 本地 |
|---|---------|------|
| 2 | `Gsn`/`x0t` · writer health ENOSPC · notif hooks | `sessionPersistenceStatus` · `transcriptWriterHealth` · REPL notifs · `sessionPersistence.217.test.ts` |
| 3 | `Qmu`/`Jmu` · persist 后 `{...e,content:a}` · message-budget replace | `toolResultStorage.maybePersistLargeToolResult` · `processMCPResult` → instructions 字符串 |
| 6 | catalog `claude-opus-4-8` · `$q`/`supports_1m_beta` · `gVc`/`xv` · Bedrock `us.anthropic.claude-opus-4-8` | `modelSupports1M`(+opus-4-8) · `configs.opus48` · `firstPartyNameToCanonical` · `getModelMaxOutputTokens` · `opus48.217.test.ts` |
| 8 | `Yqc`/`Xqc`/`qXn` · `srStartupQuietTimer` · mug=3000/hug=600000 · `CLAUDE_AX_STARTUP_QUIET_MS` · banner→Yqc | `screenReaderStartupQuiet.ts` · Ink `onRenderScreenReader`/`unmount` · `main.tsx` Yqc · `screenReaderStartupQuiet.217.test.ts` |
| 9 | `dTd`/`tdr` · `eke`/`EDs`/`aTd`/`wDs` · gdt/Sz 后调用 | `applyManagedOtelEndpointSupremacy` · applySafe/applyConfig wire · `managedOtel.217.test.ts` |
| 10 | `nXu`/`dQr` · resume drop + log | `isValidAttachmentPayload` · `dropMalformedAttachments` · `malformedAttachment.217.test.ts` |
| 12 | absolute `System32\\taskkill.exe` `/PID /T /F` · windowsHide | `ShellCommand.treeKillNoFlash` · `ShellCommand.treeKillNoFlash.test.ts` |
| 14 | `zgb` footer `u=["",c,b6p,c,Ngb]` | `attachTranscriptPreview` footerLines 前导 `''` · attach 测试 gap 断言 |
| 5 | `hsr`/`a9u`/`XNe`/`N6g`/`T_s`/`VRu`/`qRu`/`F6g`/`ZRu`/`GZe` · Write e7 · Edit/Notebook e12 · `agentWorktree` · shell stack | `bgIsolationContainment.ts`（N6g+8-hop XNe+F6g 8.3+VRu/qRu）· `worktreeGitIsolation` densable ZRu AST · Shell.exec `context_lost`+`worktree_gone`+VRu+bash ZRu · Bash/PowerShell agentWorktree wire · jobDir `T_s` · `bgIsolationContainment.217.test.ts` · `worktreeGitIsolation.216.test.ts` |
| 20 | `Hrr`/`$am`/`iSe`/`tcr` · AgentTool deny · print drain halt | `budgetHalt.ts` · `sessionSpawnCaps` · AgentTool · `print.ts` · `budgetHalt.217.test.ts` |

### Batch C — remaining AUDIT

**无** — 2.1.217 全 20 条 HAVE。

### #5 residual honesty（收口后仍故意非 densable 1:1）

| 点 | densable | 本地 | 策略 |
|----|----------|------|------|
| U5e 解析失败 | `null → {kind:"simple", commands:[], bare:[]}` | `parse-unavailable`（ZRu fail-closed deny） | **保留更严**（用户确认） |
| permission ZRu | 仅 Shell.exec | 已去掉 BashTool early-deny | 已对齐 |
| bareAssignmentNames / YPg / FJi·tLg / eq | 全量 | 全量 native（`parseForSecurityFromAst`） | 已对齐 |
| sync rough-token ZRu | 无 | 已删 `checkWorktreeSharedCheckoutGitRedirect` / `roughShellTokens` / `denyWorktreeGitRedirectIfNeeded` | 已对齐（仅 AST U5e） |

ZRu 只在 Shell.exec（`checkZRuGitRedirectCommand`）；N6g 仅 `surfaceDotDotTargets`；`surfaceNetworkRaw` 暴露给其它 surface。
