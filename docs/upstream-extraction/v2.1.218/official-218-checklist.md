# densable 2.1.218 — 官方更新清单 × go-hare 对照

> 来源：官方 2.1.218 release notes（`changelog-2.1.218.md`，**36 条**）。  
> densable 二进制：`/tmp/official-218/plat/package/claude`（VERSION **2.1.218** HIT）。  
> 基线：产品 **2.7.33** / densable **2.1.218** 已收口（`ec2617a4` + Esc/alt-screen `6d146432`）。  
> 状态：**GAP** · **PARTIAL** · **AUDIT** · **HAVE** · **N/A**  
> 约定：**extract densable first → 1:1**。不自动 commit/push/bump。  
> 更新：2026-08-08 — 补产品面：#11 Host REPL HWf 接线 HAVE；#28 RC multi-env Add-server trust UI HAVE；#15/#9 仍 invent-ban/N/A。发版线 **2.7.33**。

## 邻版关系


| 版            | 性质                                                              | go-hare         |
| ------------ | --------------------------------------------------------------- | --------------- |
| **2.1.217**  | emoji / caps / brace / hyperlink / tips / bg 可靠性                | **已收口**（2.7.32） |
| **2.1.218**  | code-review bg / a11y / auto-mode / deep-research / frontmatter | **已收口**（2.7.33） |
| **2.1.219+** | Opus 5 等                                                        | **另开 pack**     |


---

## densable 关键符号


| 符号 / 字符串                                            | 含义                          |
| --------------------------------------------------- | --------------------------- |
| `Ozs` / `pWr` / `GJc`                               | #2 SR delete announce       |
| `Zlt=256` / `yir` / `bir` / `xYr` depth             | #15 MAX_TREE_DEPTH          |
| `performance.now` turn timing                       | #18 monotonic turn duration |
| `Invalid "name": names must not contain ":"`        | #33                         |
| `true/false, 1/0, yes/no, on/off`                   | #35                         |
| `context: fork` + `background: false`               | #34                         |
| `application-inference-profile`                     | #9                          |
| `suspiciousWindowsPath` / circuitBreaker            | #26                         |
| `/code-review ultra` / ultrareview                  | #1 #7 #8 #25                |
| `hook execution - workspace trust not accepted`     | #22                         |
| `aria-preserve-whitespace` / `preserveWhitespace`   | #13                         |
| `declareCursor` / `relativeX`/`relativeY`           | #14                         |
| `chat:newline` / `ctrl+j`                           | #5                          |
| `Rft` / `uU` / `dU` / `model_switch_downgrade`      | #31                         |
| `Kka` / `DYo` / `Vsr` / `Gsr` / `mcpNeedsAuthCount` | #19                         |
| `gty` / `cLd` / `_ty` / `uLd` / `UFs` / `$Fs`       | #20                         |
| `Edt` / `Pid` / `DS` / `zfr` / `SIo`                | #6                          |
| closed-gate / `stopHeartbeat` on epoch             | #36                         |
| `m0e` / `Cxg` / `Tse` / `Ede`                       | #12                         |
| `RFo` / `drp` / `rrp` / no-progress                 | #21 overflow retry          |
| `fkd` / `ZV_` / `capMs` / `skipSpill`               | #21 Ctrl+B shell caps       |
| `q0` / `qQu` / `gen` delta coerce                   | #24 malformed delta         |
| `But` / `DZr` / `eNn` / `xv_=2000`                  | #16 PR link flush           |
| `fYt` / `pYt` / `parentClientConfig`                | #17 Bedrock proxy/partition |
| `logical_parent_uuid` / fork uuidMap                | #23 fork lineage            |
| `jYd` / `L6s` / `Cky` / `qYd` / `vky`               | #3 Windows \u path repair  |
| `vtp` / `Pl` / `Etp=2000` / sibling_context_error   | #10 IDE trunc + telemetry   |
| `LEh` / `MEh` / `B7t` / `S3l` / `hFt`               | #32 benign managed env      |
| `H0d` / `I0d` / `x0d` / `p3` / `vxo` / `gxy`        | #27 sandbox IDE restrictions |
| `odp` / `idp` / `sdp` / `Gnm` / `Dzs=3000`          | #4 left-arrow confirm + Esc origin |


---

## 全量对照（36 条）


| #   | 官方条目（摘要）                                               | 状态        | 本地备注                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `/code-review` bg subagent + stacked slash             | **HAVE**  | `parseCodeReviewArgs` densable `xol`/`AJf`/`DBT`；`resolveSlashSubcommand`；`codeReview.218.test.ts`                                                                                                                                                      |
| 2   | SR 删除文本播报                                              | **HAVE**  | `screenReaderAnnounce.ts` Ozs/pWr/GJc；`useTextInput` kill 路径；ink drain                                                                                                                                                                                  |
| 3   | Windows `\u` 路径段不误解析为 CJK                              | **HAVE**  | densable `jYd`/`L6s`/`Cky`：`toolInputUnicodeRepair.ts` + `normalizeContentFromAPI` before `normalizeToolInput`；`toolInputUnicodeRepair.218.test.ts`                                                                                                      |
| 4   | ← 确认 + AgentView Esc 回原会话                              | **HAVE**  | densable idp/sdp/odp：`leftArrowGesture.ts` + PromptInput editing-quiet（2s empty + 3s arm + GB `tengu_left_arrow_editing_guard`）；Gnm Esc attach-origin + resumeHint；`leftArrowGesture.218`/`originEsc.218` |
| 5   | 多行粘贴 Ctrl+J → 换行非 `j`                                  | **HAVE**  | densable SEA `enter:chat:submit`/`ctrl+j:chat:newline`；`handleNewline` pure twin + multi-step paste + `usePasteHandler` handlePaste/isPasting 契约；`ctrlJNewline.218` + `ctrlJNewline.paste.218`（非完整 Ink bracketed-paste E2E mount）                                                                                                                      |
| 6   | `/context` compact 后不报 stale pre-compact               | **HAVE**  | densable `Edt`/`Pid`：message-picker partial compact 对 `messagesToKeep` 助手 `usage` 置零，避免 `zfr`/`getCurrentUsage` 读到 pre-compact 总量；`buildPartialPostCompactMessages` + REPL onSummarize；`partialPostCompact.218.test.ts`                                                                 |
| 7   | `/ultrareview` 描述性参数 → findings note                   | **HAVE**  | prose path + previewInstructions；`ultrareview.218.test.ts`                                                                                                                                                                                              |
| 8   | `/code-review ultra` 非交互 cloud                         | **HAVE**  | densable dual reg：`ultrareview` local-jsx + `ultrareviewNonInteractive` local/`supportsNonInteractive`；`ultrareviewHeadless` Pvy gate + launch；FBT note + `DEFAULT_INVOCATION`；`ultrareviewHeadless.218.test.ts` |
| 9   | Bedrock application-inference-profile 计量               | **N/A** + **HAVE** | 官方条目 = **gateway spend metering**（SEA `x-gateway-spend-admin` / `spend meter has no exact rates`）— go-hare **不发 gateway** → 官方面 **N/A**。CLI cousin **HAVE**：`getInferenceProfileBackingModel` + `claude.ts` `resolvedModel` when model includes `application-inference-profile`；`bedrockInferenceProfile.218.test.ts`（勿把 gateway 勾成 CLI HAVE） |
| 10  | IDE selection mid-emoji mojibake + tool executor error | **HAVE**  | densable `vtp`/`Pl`/`Etp=2000`：`truncateIdeSelectionContent`；`selected_lines_in_diff` gIy + Ctp；`buildSameTurnToolUses` → `tengu_auto_mode_sibling_context_error`；`ideSelectionTruncate.218.test.ts`                                                      |
| 11  | engine teardown phantom turn + close 后拒输入              | **HAVE** | densable S8o 控制面 + **产品接线** + **sticky→permissionLayers** + **bn/qO/_Kr/yor 消费者**：`hostEngine.ts` + `hostPermissionLayers.ts` + `permissionLayerReaders.ts`（bn/qO/_Kr/YDu/bb/yor）；接线 `permissions.ts`/`query.ts`/`toolExecution.ts`/`useCanUseTool`；`hostEngine.218` + `hostPermissionLayers.218` + `permissionLayerReaders.218` |
| 12  | 假 `[Request interrupted by user]` + unpaired tool_use  | **HAVE**  | densable `m0e`/`Cxg`：`shouldSuppressInterruptionMessage` (interrupt + refusal-fallback-edit)；Tse 字段 plumb；query/stopHooks 统一 gate；pairing 既有 `yieldMissingToolResultBlocks`/`ensureToolResultPairing`；`interruptSuppress.218.test.ts` |
| 13  | VoiceOver 末尾空格不读 "new line"                            | **HAVE**  | preserveRanges + BaseTextInput `aria-preserve-whitespace`                                                                                                                                                                                               |
| 14  | plugin/settings 焦点行移终端光标                               | **HAVE**  | ink `ListItem.declareCursor` + `useDeclaredCursor`；CustomSelect `SelectOption` 转发；`declareCursor.218.test.ts`                                                                                                                                                                                                |
| 15  | 深嵌套 watch/UI maximum call stack                        | **HAVE**  | densable `Zlt=256`/`yir`：hitTest / renderNodeToOutput / SR extract / findStart / dropSubtreeCache；`maxTreeDepth.218.test.ts`。**勿发明** FS `MAX_WATCH`/watch depth=256（SEA 是 Ink 树，非 chokidar twin）；settings `depth:0` + skills `depth:2` 已有                                                                                                          |
| 16  | PR events 立刻退出时丢失                                      | **HAVE**  | densable But/DZr/eNn：`pendingPrLinks` + `trackPendingPrLink`/`flushPendingPrLinks`(2s)；trackGitOperations 不再 fire-and-forget；gracefulShutdown await DZr；`pendingPrLinks.218.test.ts`                                                                 |
| 17  | Bedrock setup wizard assume-role / partition / proxy   | **HAVE**  | densable fYt/pYt + `$5` chain + `setup-bedrock` wizard：`createWizardCredentialProvider` iEp parentClientConfig.region+requestHandler 双挂；rZs/Fzy/Nzy；`setupBedrockVerify.218.test.ts`                                                                 |
| 18  | turn duration 单调时钟                                     | **HAVE**  | REPL/Spinner：`performance.now()` 计 turn/pause/swarm 时长（非 Date.now）；`monotonicTurn.218.test.ts`                                                                                                                                                                  |
| 19  | MCP auth 启动提示高估 claude.ai connectors                   | **HAVE**  | densable `Kka`/`DYo`/`Vsr`/`Gsr`：`countMcpNeedsAuth` + `shouldCountMcpClientForAuthNotice`；`eligible` plumb；session `Pgs`；`useMcpConnectivityStatus`；`mcpNeedsAuthCount.218.test.ts`                                                                    |
| 20  | prompt history race 丢/重                                | **HAVE**  | densable `gty`/`cLd`/`_ty`/`uLd`/`UFs`/`$Fs`：snapshot-then-filter flush、consecutive dedupe、skip-key+sessionId、mid-flush remove；`history.race.218.test.ts`                                                                                               |
| 21  | context-overflow 重试死循环 + Ctrl+B shell caps             | **HAVE**  | densable RFo/fkd：`decideMaxTokensOverflowAdjustment` 仅 `availableContext` + no-progress abort；`ShellCommand.background({capMs,skipSpill})`；`resolveSubagentBgShellCapMs`/ZV_=1h 在 spawn+Ctrl+B+auto-bg；`overflowRetry.218`/`bgShellCap.218`/`ShellCommand.bgCap.218` |
| 22  | agent frontmatter hooks 需 workspace trust              | **HAVE**  | densable mvo/hvo + **QEt mainThread**：`applyMainThreadAgentHooks` + bootstrap `mainThreadAgentHooks`；main.tsx/sessionRestore 接线；`hooks.ts` fne merge；subagent 仍 `runAgent`；`applyMainThreadAgentHooks.218.test.ts` |
| 23  | fork-session lineage compaction 后丢失                    | **HAVE**  | densable `logical_parent_uuid`：schema + QueryEngine 双 yield + mappers to/from + branch createFork uuidMap remap（skip progress）；`logicalParentUuid.218.test.ts`                                                                                        |
| 24  | resume malformed delta attachment                      | **HAVE**  | densable q0：`asStringArray` + `normalizeAttachmentForAPI` delta cases + DTD/MID/ALD history scans pair-rule；qQu/gen 既有；`asStringArray.218.test.ts`                                                                                                      |
| 25  | `/ultrareview` 无效参数错误反馈                                | **HAVE**  | 与 #7/#8 同路径 + `ultrareview.invalidArg.218.test.ts`（diff-too-large / empty-diff correctable copy）                                                                                                                                                                                                                                              |
| 26  | auto-mode dangerous-rm/`&`/Win path → classifier       | **HAVE**  | circuitBreaker + tests                                                                                                                                                                                                                                  |
| 27  | sandbox IDE 命令限制加强                                     | **HAVE**  | densable H0d/I0d/x0d/p3/vxo：`isFullyExcludedCommandForPolicy` metachar fail-closed；PS validate/call I0d；`SandboxPolicyRefusalError`；`sandboxPolicy.218.test.ts` |
| 28  | trust dialog 标明 repository root                        | **HAVE**  | Accessing 正文 densable 1:1；**`/cd` CdTrustPrompt** + Omt/EUe + tNt；**RC multi-env**：free-text Directory/Name + spawn + Trust（densable `ba cancelFirst/focus cancel` → Select `defaultValue='no'` + CANCEL 在前；subtitle=trust body）→ Omt → qpn；slash add + list/remove；`RemoteControlAddServerDialog.trust.218` |
| 29  | `/deep-research` 仅手动启动                                 | **HAVE**  | skill `disableModelInvocation: true`；bundled workflow **hidden**（模型列表不可见，仍可 `Workflow({name})` 由 skill 展开）；`deepResearch.disableModelInvocation.218` + `bundledDeepResearch` |
| 30  | plan+auto 无法证明 RO 的 Bash → classifier                  | **HAVE**  | densable fXd `plan_mode_floor` + ctn plan-as-auto；`permissions.ts`；`circuitBreaker.218` 含 plan+auto-mode ctn 测（feature 关则 skip）；与 #26 **独立条目**                                                                                                      |
| 31  | 模型切换导致 fast mode 变化时播报                                 | **HAVE**  | densable `Rft`/`uU`/`dU`：`formatModelSwitchFastModeSuffix`/`resolveFastModeAfterModelSwitch`/`applyFastModeOnModelSwitch`；Config `/config model` + PromptInput + `/model` + print/bridge `set_model` + useReplBridge；`fastMode.modelSwitch.218.test.ts` |
| 32  | server-managed 良性开关不触发 settings-approval               | **HAVE**  | densable LEh(180)+MEh+B7t/`isSafeManagedEnv`；S3l full shell list + `{command}`；claudeMd projection；`benignEnv.218.test.ts`                                                                                                                              |
| 33  | agent 名禁止 `:`                                          | **HAVE**  | `validateAgentMarkdownName` + tests                                                                                                                                                                                                                     |
| 34  | fork skill 默认 background                               | **HAVE**  | `forkedSkillBackground` + frontmatter                                                                                                                                                                                                                   |
| 35  | frontmatter 布尔 yes/no/on/off/1/0                       | **HAVE**  | `parseBooleanFrontmatter` / `tryParseBooleanFrontmatter` + densable 错误串 `formatFrontmatterBooleanError`；**densable BJy/`$Jy` plugin install `--config KEY=VALUE`**（`parsePluginCliConfig.ts` + `main.tsx`/`pluginInstallHandler`/`installPlugin` 接线 + soft `Installed, but --config not applied:`）；`parsePluginCliConfig.218.test.ts` + frontmatter 测 |
| 36  | remote worker 替换后停 heartbeat                           | **HAVE**  | densable CCRClient closed-gate before 409; start/sendHeartbeat no-op when closed; handleEpochMismatch stopHeartbeat first; `ccrClient.ts` + `ccrClient.218.test.ts`                                                                                        |


---

## 统计（2026-08-08 对抗复审后）


| 状态          | 条数     | 说明                                                                 |
| ----------- | ------ | ------------------------------------------------------------------ |
| **HAVE**    | **35** | CLI/本地面 1:1 含 #11 Host 产品接线 + #28 RC Add-server；#9 N/A 不计 solid；#35 既有测 |
| **N/A**     | **1**  | **#9 官方 gateway spend metering**（go-hare 无 gateway 产品）              |
| **CLI cousin** | **1** | #9 另计 CLI `application-inference-profile` cost resolve **HAVE**（不并入 36 solid） |
| **GAP**     | **0**  | —                                                                  |
| **PARTIAL** | **0**  | —                                                                  |
| **AUDIT**   | **0**  | —                                                                  |
| **合计官方条**   | **36** | 禁止再写「36/36 solid HAVE」— 复审 OVERCLAIMED 已纠正                           |


> **Batch A**：#33 #35 #34 #29 → HAVE  
> **Batch B**：#1 #7 #8 #25 → HAVE  
> **Batch C**：#26 #30 #22 → HAVE  
> **Batch D**：#2 #13 #14 → HAVE  
> **Batch E**：#3–#6 #10 #12 #15–#21 #23 #24 #27 #28 #31 #32 #36 → HAVE；#4/#17 HAVE  
> **#11**：控制面 + REPL HWf 产品接线 **HAVE**（2026-08-08 补产品面）  

> **#9**：gateway N/A；CLI cousin HAVE + 218 测  
> **复审补丁**：#28 Accessing 正文 1:1 + Cd 串共享；#5/#36 218 测；#35 错误串；stats 诚实化

---

## Batch D/E 关键文件


| 区域                    | 路径                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| SR announce           | `packages/@ant/ink/src/core/screenReaderAnnounce.ts`                                                           |
| SR tree/park          | `screenReaderTree.ts` / `screenReaderPark.ts` / `ink.tsx` onRenderScreenReader                                 |
| MAX_TREE_DEPTH        | `packages/@ant/ink/src/core/maxTreeDepth.ts` + hit-test / render-node-to-output / screenReaderTree             |
| kill wire             | `src/hooks/useTextInput.ts`                                                                                    |
| trailing space        | `src/components/BaseTextInput.tsx`                                                                             |
| JSX types             | `src/types/ink-jsx.d.ts` + package d.ts + `DOMAccessibility` export                                            |
| monotonic turn        | `src/screens/REPL.tsx` + Spinner*                                                                              |
| trust root + /cd       | `TrustDialog` + `trustDialogCopy` + `commands/cd` CdTrustPrompt + `cdCommand.218`                               |
| #8 non-interactive ultra | `ultrareview` + `ultrareviewNonInteractive` + `ultrareviewHeadless` + LocalCommandResult `query`            |
| #22 mainThread hooks   | `applyMainThreadAgentHooks` QEt + `mainThreadAgentHooks` + hooks.ts fne merge + main/sessionRestore          |
| #29 deep-research hide | skill disableModelInvocation + bundled workflow `hidden: true`                                               |
| #31 fast model-switch | `src/utils/fastMode.ts` Rft/uU/dU + Config/PromptInput/model/print/useReplBridge                               |
| #19 mcp needs-auth    | `countMcpNeedsAuth`/`shouldCountMcpClientForAuthNotice` + claudeai eligible/session + useMcpConnectivityStatus |
| #20 history race      | `src/history.ts` gty snapshot-filter + cLd retry + _ty dedupe + UFs/$Fs                                        |
| #6 Pid/Edt             | `buildPartialPostCompactMessages`/`zeroKeptAssistantUsage` + REPL onSummarize + `partialPostCompact.218.test.ts` |
| #12 m0e/Cxg             | `shouldSuppressInterruptionMessage` + query/stopHooks Tse gate + `interruptSuppress.218.test.ts` |
| #21 overflow + capMs    | `decideMaxTokensOverflowAdjustment` + `ShellCommand.background({capMs})` + `resolveSubagentBgShellCapMs` + 218 tests |
| #24 q0 delta coerce     | `asStringArray` + messages normalize delta + DTD/MID/ALD scanners + `asStringArray.218.test.ts` |
| #16 PR flush            | `pendingPrLinks` / `trackPendingPrLink` / `flushPendingPrLinks` + gracefulShutdown + gitOperationTracking |
| #17 Bedrock wizard+chain | `setup-bedrock` + `setupBedrockVerify` iEp/rZs/Fzy + fYt/pYt + `$5` chain |
| #23 logical_parent_uuid | coreSchemas + QueryEngine yields + mappers + branch createFork uuidMap |
| #36 heartbeat closed    | `src/cli/transports/ccrClient.ts` closed-gate / stopHeartbeat on epoch                                          |
| #11 S8o closed-gate     | `src/engine/hostEngine.ts` + `hostEngine.218.test.ts` + lifecycle/CCR map                                      |


---

## 诚实边界

- SEA bins 保持 dirty，不进 pack 提交。  
- 全量 `bun test` 仍有与本 pack 无关的既有失败；**`*.218.test.ts` 以本轮 residual 测为准**（#8/#22/#28 新增 headless/mainThread/cd）。  

- AUDIT→HAVE 必须 densable extract 证据，禁止凭感觉勾。  
- **不自动 commit / push / version bump** — 仅用户要求时。  
- 2026-08-08 对抗复审：#9 gateway **不得** solid HAVE；禁止 36/36 solid。同日用户「补产品面」后 #11 Host / #28 RC Add-server 已接线 — 见 `snippets/residual-four-honest.txt`。  
- #9 CLI cousin 与 gateway 产品面分离记账，避免再次混淆。

