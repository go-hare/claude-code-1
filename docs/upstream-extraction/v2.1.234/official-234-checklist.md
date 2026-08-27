# densable 2.1.234 — 官方更新清单 × go-hare 对照

> 来源：GitHub release **v2.1.234**（2026-08-17）+ densable SEA win32-x64。  
> SEA：`%LOCALAPPDATA%/Temp/official-234/plat/package/claude.exe`；size **324028576**；sha256 `3f877e78543e2cb4daad61d18f06cc11028f9dffc1afd41ccf1f8f84cf02eb1b`。  
> 基线：本地 tip densable **2.1.233** + npm **2.7.44**。**本 pack 只对齐 2.1.234**。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN** · **NOOP**  
> 约定：**extract densable first → 1:1**。不自动 commit/push/bump。不 invent cloud/gateway/Desktop-only。  
> Binary beats changelog。更新：2026-08-19 — sticky React #185 1:1；P0 HAVE；**#3/#4/#5/#7/#9/#11/#12/#16/#18/#19/#20/#40/#21/#22/#36/#43/#6/#13/#14/#28/#29/#34/#37/#44/#51/#42/#15/#48 HAVE**；#35 GAP invent-ban；next remaining P2/UNKNOWN。

## 邻版关系

| 版 | 性质 | go-hare |
| -- | ---- | ------- |
| **2.1.233** | MCP listen / Todo 门 / Windows `\??\` 等 | tip |
| **2.1.234** | 51 条：PROJECT_DIR_NAME / selection:clear / usage-limit continue / teammate model 移除… | **本 pack** |
| **2.1.235+** | 未提取 | 勿折入 |

## densable 关键符号（SEA 锚）

| 符号 / 字符串 | 含义 | 本地 |
| --- | --- | --- |
| `T6c` / `XLe` / `CLAUDE_CODE_PROJECT_DIR_NAME` | 可选短名覆盖 projects/* 目录名 | **HAVE** |
| `h8i` / `"selection:clear"` | Scroll 上下文清选区 keybinding | **HAVE**（Scroll + AgentView） |
| `autoContinueAtUsageLimit` + label | usage limit 自动续跑 + `/config` | **HAVE** |
| `Default teammate model` / `teammateDefaultModel` count=0 | 设置已拆除 | **HAVE**（本轮） |
| `Allowed by auto mode classifier` + `rrt.name!==di` | Agent 工具结果下不再刷该行 | **HAVE** |
| `CLAUDE_CODE_GOAL_CHECKIN_MINUTES` | goal 后台久等 check-in | **HAVE** |
| sticky `jpw`/`Wrn` | StickyTracker idx dedup + pad=`sticky!=null` | **HAVE**（本轮 React #185） |

## 当前计数（初稿 2026-08-18）

| 状态 | 条数 | 说明 |
| ---- | ---- | ---- |
| **HAVE** | **43** | 51 − #35 GAP − 6 N/A − `#4` PARTIAL |
| **PARTIAL** | **1** | `#4` quota：仅 REPL；print 无 |
| **GAP** | **1** | #35 profile `/login` invent-ban |
| **N/A** | **6** | #25/#30–#33/#50 Desktop/cloud/Mantle |
| **UNKNOWN** | **0** | |

> 计数随续扫修正。HAVE ≠ 零 residual。

## 全量对照（51）

| # | 官方要点 | 判定 | 本地证据 / densable 金标 | 备注 |
| - | -------- | ---- | ------------------------ | ---- |
| 1 | `CLAUDE_CODE_PROJECT_DIR_NAME` | **HAVE** | SEA `T6c`/`XLe`/`bws`；`sessionStoragePortable` + memo `getProjectDir` | peel `_peel_project_dir_name.txt` |
| 2 | `selection:clear` keybinding | **HAVE** | SEA `h8i`；`useSelectionClearKeybinding` + AgentView chrome | peel `_peel_selection_clear.txt` |
| 3 | GitLab MR badge footer/statusline | **HAVE** | SEA `_pp`/`lpp`/`aWb`/`lWb`/`nWb=2500`；`fetchPrStatus` = gh `pWb` ?? glab；`PrBadge` `!N`；harbor_prism `yWb` 不移植 | `ghPrStatus.234.test.ts`；`_peel_3_notes.md` |
| 4 | Continue at usage limit + `/config` | **PARTIAL** | SEA Wqn/BXa/…；`quotaAutoResume.ts` + Config + rate-limit + REPL `useQuotaAutoResume`。**print.ts 无** → HAVE 写成全表面是假账；REPL 面绿 | `quotaAutoResume.234.test.ts` |
| 5 | Account email only to identify you | **HAVE** | SEA `UPb`；`getUserContext` 注入 identify-only `userEmail`（`ANTHROPIC_UNIX_SOCKET` 跳过） | `userEmailContext.234.test.ts` |
| 6 | `\??\` NT-namespace 更多预批准面 | **HAVE** | SEA `Jw`/`su`/`Yhe`/`yR`/`qh`/`s7t`/`lMp`/`k0c`/`dvr`/`gno`；path helpers + workflow scriptPath + Shell cwd + publish Artifact/SendUserFile + FileRead Jw + FileEdit skip + claudemd + sessionRestore | `ntNamespace.234.test.ts` + WorkflowTool s7t |
| 7 | Auto mode 长会话 compact 后重复拒网络 | **HAVE** | SEA wkr/lVr/Jvr/zvb/KXt/LOr/W4g；sessionAllowedHosts + REPL/print/SDK/InboxPoller | `sandboxNetworkDecision.234.test.ts` + `sessionAllowedHosts.234.test.ts`；`_peel_7_notes.md` |
| 8 | bg subagent 权限答案 session-scope 丢失 | **HAVE** | SEA y8r/m4n/n3e/Bie/Ina；session setter 继承 + persist deny/allow | `sessionPermissionPersist.234.test.ts`；`_peel_8_notes.md` |
| 9 | non-streaming fallback 缺 thinking/text 崩 | **HAVE** | SEA `KKn`；`normalizeContentFromAPI` flatMap heal/drop + meta requestId/messageId；stream/nonstream/404 调用点传 meta | `normalizeContentFromAPI.234.test.ts` |
| 10 | Markdown 异常 Unicode 极慢 | **HAVE** | SEA CXr `PPE`/`DPE`/`d0l`/`uq`/`j6m.table`；`configureMarked`+link d0l；非 Bun.markdown | `markdownUnicode.234.test.ts`；`_peel_10_notes.md` |
| 11 | SendMessage 拒 ListAgents 超长/emoji 名 | **HAVE** | SEA `Agf=300`/`b4a`/`bVv=Tgf(Agf)` unicode `u`；`to` schema regex | `sendMessageToMax.234.test.ts` |
| 12 | git remote userinfo host 误读 | **HAVE** | SEA `Aoe` userinfo `[^@/?#]*` + host `[^/:?#@]` + `fTt`/`Fdu` | `detectRepository.test.ts` |
| 13 | MCP diagnostics 打出密钥 | **HAVE** | SEA `Gpi`/`cHr`/`Ujo`/`McE`/`hP`；displayServers `expandVars:false`；reconnect/ENDPOINT origin-only | `mcpScopeConflicts.234.test.ts` |
| 14 | `strictKnownMarketplaces` SCP host 不一致 | **HAVE** | SEA `pTt`/`I8s`/`zAd`/`WAd`/`JAd`/`Obn`/`BAd`；owner/* case-sensitive `ztb` | `marketplaceHostPattern.234.test.ts` |
| 15 | fullscreen 模态复制丢字 | **HAVE** | SEA `y8i`/`g8i`/`f` lastCopied + `_e("clipboard_write")` + ctrl+c cache toast + auto-copy tip `Cvh`/`wtw=10`/`Rvh=5`; `useCopyOnSelect` + ScrollKeybindingHandler | `useCopyOnSelect.234.test.ts` | |
| 16 | `---` HR 贴上下行 | **HAVE** | SEA `jG` `case"hr":return"---"+AY`；`formatToken` hr → `'---'+EOL` | `markdownHr.234.test.ts` |
| 17 | 连续 shell + todo 拆成多行 "Ran 1" | **HAVE** | SEA `Qoi`/`Yrr`/`edv`: TodoWrite+Task* `isAbsorbedSilently`+`popsOutOnError`; collapseReadSearch | `collapseReadSearch.234.test.ts` |
| 18 | `!` shell 结束 dismiss `/permissions` | **HAVE** | SEA DWS `immediate:!0` + REPL `localJSXCommandRef` 忽略 bash `setToolJSX(null)`；无 invent finish≠dismiss API | `permissions.234.test.ts` |
| 19 | 排队 `!` ↑编辑后当纯文本 | **HAVE** | SEA `ve`/`NMt`：空输入才 pop bash；返回 `mode`；PromptInput/REPL `onModeChange(result.mode)` | `popAllEditable.234.test.ts` |
| 20 | 排队消息/Esc/`!` mode 粘住 | **HAVE** | historyEntry+JDr；onSubmitProceed 清 bang；Esc-select 不中断；`lte`↑↓ `queueEditIndex` + `Ne`/`Io`/`F3i`/`Vag`/`SQw`/`$l`；`ke` paste-remap 与 popAll 同 residual | `popAllEditable.234.test.ts` + `handlePromptSubmit.234.history.test.ts`；`_peel_20_notes.md` |
| 21 | fullscreen renderer 重启丢 flags | **HAVE** | SEA `Cmt`/`Rmt`/`QOa`/`nMr`；`tuiRelaunchCarry` + `buildTuiRelaunchPlan`；upsell `carryFromAppStore` | `tuiRelaunchCarry.234.test.ts` |
| 22 | `/tui` 丢 `--allowed-tools`；不可带则拒绝 | **HAVE** | SEA `W4e`/`UYh`/`iyt`/`nfo`/`Zpc`/`xve`；refuse before save + active-task refuse + `tengu_tui_refused` | panel/upsell/non-interactive AppState carry；`tuiRelaunchBlocker.234.test.ts` |
| 23 | trust 仓库级警告（dir 先于 repo） | **HAVE** | SEA `I8e`=`rHo`→`Ydu` uncached；`findCanonicalGitRootUncached` + trust key/cd/set_cwd/Accessing | `gitRootUncached.234.test.ts`；`_peel_23_notes.md` |
| 24 | IDE diff 关 tab 重提示用旧输入 | **HAVE** | SEA `Fmi`/`Mrf`/`Rrf`/`L4n`/`runHooks`→`reprompted`; `closedRef`+queue update without claim | `ideDiffReprompt.234.test.ts`; `_peel_24_notes.md` |
| 25 | RC Desktop/VS Code 上传到用户 | **N/A** | invent-ban | |
| 26 | `/login`+OAUTH_TOKEN 提醒不进模型 turn | **HAVE** | SEA `TRh`/`ERh`/`Xrn`/`kRh`；auto-query → out-of-band notice，不进 stdout | `oauthTokenEnvWarning.229.test.ts`；`_peel_26_notes.md` |
| 27 | permission preview 仅信任 channel | **HAVE** | SEA `Yrf`/`Xrf`/`i3r`/`t2a`/`s3r`; inbound registered-set + allowlist/era/provider/policy; weixin builtin kept | `_peel_27_notes.md`; `channelInboundTrust.234.test.ts` |
| 28 | preview 脱敏不藏 cmd/path；私钥强脱敏 | **HAVE** | SEA `VKc`/`zhy`/`Lhy`；display skip shell/path chars；PEM Lhy full redact | `permissionPreviewMask.234.test.ts`；verifier PASS + spot-check |
| 29 | provider token 紧贴 shell 分隔符仍脱敏 | **HAVE** | SEA `$hy`/`BKc` display boundary；`truncateForPreview`→`tAt` | same |
| 30 | Desktop 跨会话消息静默丢 | **N/A** | | |
| 31 | RC 换账号秒停 + reason | **N/A** | cloud | |
| 32 | RC perm/model 同步手机 | **N/A** | | |
| 33 | RC phone effort → 宿主 | **N/A** | | |
| 34 | SendMessage/ListAgents 列表过长说明 | **HAVE** | SEA `Gff`/`wWr`/`iza`/`CSf` + `searchTruncated`（cloud\|\|bridge）；ListAgents notes；SendMessage success/ambiguous/not-found append；`qGv` page budget 5 | peel `_peel_34_*`；`*.234.test.ts` |
| 35 | 过期 profile → `/login` 优先 | **GAP** | SEA `oRr`/`Swn`/`ubS`/`cbS`/`A5`/`uD`/`z_`；go-hare 无 `~/.config/anthropic` profile 栈，禁止 stub 死文案 | `_peel_35_notes.md` |
| 36 | 用户 prompt 渲染 markdown | **HAVE** | SEA `j3i`/`jh`/`promptMode`/`z6m`/`V3i`；`HighlightedThinkingText`→Markdown promptMode；truncate `{head,hiddenLines,tail}`；Divider `titleAlign:start` | `userPromptMarkdown.234.test.ts` |
| 37 | 空/畸形 API 错误更详 | **HAVE** | SEA `Pai`/`Tbv`/`Sbv`/`tHa`/`OUf`；`unexpectedApiResponse.ts` + `executeNonStreamingRequest` `.withResponse()` gate + originating stall | `unexpectedApiResponse.234.test.ts` |
| 38 | 自动 session 标题短名 | **HAVE** | `sessionTitle.ts` | |
| 39 | `claude-api` skill ~25k on-demand | **HAVE** | SEA `Dy0`/`Oy0`/`Hy0`/`Kwd`; SKILL.md + lang README only; extract-fail live-sources; no mass dump | `_peel_39_notes.md`; `claudeApi.onDemand.234.test.ts` |
| 40 | `/permissions` 工作中可开 | **HAVE** | 同 #18：`immediate: true` → mid-turn immediate local-jsx path | `permissions.234.test.ts` |
| 41 | `/add-dir` 等 mid-turn fullscreen | **HAVE** | ARt + Ns/X3e/RVr；help/theme/add-dir/config/advisor/autocompact；`autoCompactWindow` settings | `immediateCommand.234.test.ts` / `autoCompactWindow.234.test.ts` |
| 42 | `/goal` 不可恢复错误自清 | **HAVE** | SEA `pXp`/`LMv`/`MMv`/`K1a`/`TOe`/`tengu_quartz_pipit`；`goalUnrecoverableClear.ts` + Terminal `api_error` + REPL `runTurn` finally + `onActiveGoal` clear；errorKind `oauth_org_not_allowed`/`model_not_found` | `goalUnrecoverableClear.234.test.ts` |
| 43 | `/goal` 30min check-in env | **HAVE** | SEA `wPv`/`iYp`/`APv`/`kPv`/`DMv`；`goalCheckin.ts` + stopHooks defer+inject；SPv=30；`=0` 关闭 | `goalCheckin.234.test.ts` |
| 44 | `setup-token` 拒多余参数 | **HAVE** | SEA `.allowExcessArguments(false)`；`registerCliHostCommands` + `main.tsx` | `setupTokenExcessArgs.234.test.ts` |
| 45 | Esc fullscreen 不清 mouse 选区 | **HAVE** | densable `bvh`/`Jew` 1:1（escape/page/ctrl+home|end 不清）；`shouldClearSelectionOnKey.234.test.ts` | |
| 46 | 去掉 Agent 下 "Allowed by auto…" | **HAVE** | SEA `rrt.name!==di`；`UserToolSuccessMessage` skip Agent | |
| 47 | **移除 Default teammate model** | **HAVE** | Config 行/ submenu 已删；`teammateModel` 不再读 config；legacy 字段 unread | 本轮落地 |
| 48 | 运行中工具 header 耗时 dim | **HAVE** | SEA `u5e` dimColor:!0 on `(elapsed)` / timeout; local `ShellTimeDisplay` + `ShellProgressMessage` Running…+u5e 1:1 | peel `_peel_48_*` | |
| 49 | 回合间 bg 通知进 mid-turn 同标签 | **HAVE** | SEA `fXs`/`NCn`/`$Cn`; API normalize `wrapTaskNotificationForApi` + origin void; mid-turn queued_command already system-reminder | `_peel_49_notes.md`; `wrapResumePromptOrigin.test.ts` |
| 50 | Mantle skip admin-pin probe | **N/A** | Mantle | |
| 51 | Windows RO `~/.claude.json` 启动 rename 卡死 | **HAVE** | SEA `ulu`/`fIs`/`vVy`/`SVy` RO fail-fast；`renameRetry.ts` → `writeFileSyncAndFlush_DEPRECATED` + `symlinkWriteGuard` | `renameRetry.234.test.ts` |

## Explicit non-claims

- 不 invent Desktop / phone / claude.ai cloud RC（#25/#30–#33）与 Mantle（#50）。  
- sticky React #185：**1:1 densable jpw/Wrn**，禁止再加本地 hysteresis。  
- #47：磁盘上旧 `teammateDefaultModel` 可留，**禁止**再读入解析。  
- 提交时 **勿 stage** SEA 二进制、`docs/upstream-extraction/v2.1.212/**` 大 peel、`nul`。

## 本轮已落地

1. **Sticky 1:1** — `FullscreenLayout` / `VirtualMessageList` StickyTracker / idx-dedup 测试；注释对齐 densable。  
2. **#47** — 移除 `/config` Default teammate model；`resolveTeammateModelWith` 仅 leader → mainLoop → hardcoded。  
3. **#4** — `autoContinueAtUsageLimit`：settings effective（absent⇒true）+ maple_sundial Config toggle + rate-limit arm/cancel + 30s tick + Esc Gis cancel + wait notices。  
4. **AgentView `vvh`** — `createSelectionClearKeyDownCapture` → root Box `onKeyDownCapture`（densable FleetView E7）。

## 测试

- `src/utils/swarm/__tests__/teammateModel.test.ts`（#47）  
- `src/components/__tests__/stickyClearHysteresis.test.ts`（idx dedup）  
- `src/services/__tests__/quotaAutoResume.234.test.ts`（#4）  
- `src/components/__tests__/shouldClearSelectionOnKey.234.test.ts`（#45/`vvh`）
