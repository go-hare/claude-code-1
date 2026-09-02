# leftover PPi / V1w / bvr / U_c / H_a — 2026-09-01 挖

Living peel（可改）。金标在 `.tmp-peel-local-leftover.txt` + `snippets/gold-u51*.txt` / `gold-rev-dhm.txt`。

2026-09-01 **功能对齐已落**：有 host 的 leftover 接到产品面。`bvr` 官方有 schema 的行（含 `switchModelsOnFlag` / `externalEditorContext` / `precomputeCompactionEnabled` / `timestamps`）已挂；Artifact comment census 可见面是 `status` tool 文案（无 Ink 面板）。仍 invent-ban：`$t()`/`tn()` 云 persist、DID/`p5i`、`$_a`/`$Hm` formerNames、`agentsView` `/config` 行、cobalt Artifact 读面、`kpw` sidecar、`fvl` activity 当终端控件。

## PPi — git diff fetch（`fetchGitDiff`）

官方 `PPi(cwd, signal, mode="auto")` @309869736：

| mode | 金标 |
| ---- | ---- |
| 非 git / transient | `null` |
| `branch` | `WFf(..., force=true)` |
| HEAD miss | `Sil` empty-repo |
| HEAD 文件数 > `kJn` | working-tree，不挂 untracked |
| `session` | `Promise.all([_zS(o), RPi(o, signal, undefined, true)])` 后 working-tree |
| `uncommitted` 或 HEAD 已有改动 | working-tree + `RPi` untracked |
| `auto` 且 working 空 | 再试 `WFf`；空则回 working |

本地 `src/utils/gitDiff.ts` `fetchGitDiff` 决策树 1:1。`RPi` = `attachUntracked` / `fetchUntrackedFiles`。REPL `ReplDiffPanel` 已接 `useDiffData(baseMode, revision)` + `cycleDiffBaseMode`（`Pec` = session/uncommitted/branch）。`H_s` 第一参 `e` = `fileHistory.snapshotSequence`；DiffDialog 同样传 revision，默认 mode 仍 uncommitted。

**HAVE（2026-09-01 功能对齐）：** `getSessionStartTime()` = `STATE.startTime`。`_zS`=`markPreSessionFiles`。`AzS`=`fetchUntrackedFiles(..., includePreSession)`（uncommitted 丢掉 preSession untracked）。`useDiffData` 传 `preSession`；`Zmu` 主列表不画这些文件。

**HAVE（2026-09-01 收口）：**

| 符号 | 本地 |
| --- | --- |
| `H_s` refetch | **HAVE。** `useDiffData(mode, revision)` deps `[mode, revision]`。revision = `snapshotSequence`（官方第一参 `e`）。第一次之后静默重拉；`noCommits` 从 `Sil` 透出。`PPi` `null` / throw 只关 loading，**不**清已有 `s`；`VFf` `null` 走 `nextHunksOnVFf`（同 `CJn` 保留 hunks）。`s`=`{result,baseMode,hunks}`，有数据回 `s.baseMode`（Zmu `iNo` / `displayMode`）。`be`/`Ee`=`tengu_feature_sad`/`_ok`（`repl_diff_read` + `git_diff_failed`/`git_hunks_failed`/`git_diff_threw`）。`isLargeFile` 只看 `s.hunks.skippedLarge.has`。 |
| `VFf` / `vzS` | **HAVE。** `fetchGitDiffHunks`：非 git / `qFf` → null；shortstat `filesCount > kJn` → 空 `r_g`（不拉 raw）；`diff -c diff.relative=false` + `ANr`；`--cached` 且 hunks 非空时 `GFf` 删 working-tree 同行（GFf null → VFf null）。`parseGitDiff`=`vzS`：cap 是 `hunks+skippedLarge >= Eil`；`o.length > HPi` → `skippedLarge.add(path)`。`kJn`/`Eil`/`HPi` 用已有 500 / 50 / 1MB。`uea`/`HR0` 仍无体 KEEP。 |
| `Sil` + `bzS` + `GFf` | 空仓库：`--cached` 后，`0 < files ≤ kJn` 时 `git diff --numstat`（无 ref、不 spread `gnr`）折进 staged 同行：`added = max(0, staged + wt.added - wt.removed)`，`removed` 清零；任一侧 binary → added 0。然后 `RPi`。`> kJn` 提前返回。`foldEmptyRepoWorkingTreeStats`。 |
| `Zmu` `H1s` | `replDiffPreSessionStats`：只加总 `preSession`。主列表仍隐藏这些行；`filesCount > 0` 时底部 `N files  +X -Y`。leftover JSX 在 empty copy 前截断，不另造 “before this session” 文案。 |

旧句「无 `GZt` 时钟」假。旧句「session/branch 无 host」假（host 是 `DiffBaseMode`）。旧句「No bzS index rewrite」假：`bzS` 是 numstat 折入，不是改 git index。

## V1w — ListAgents `formatForModel`

官方 `V1w(peers, extras, flags)`：拆 uds/cloud/bridge/did → `GCe` 候选 Map → `MHm` Subagents `J1w` → `OHm` Teammates `Z1w` → 非 did-focused 时 `Q1w` Peer sessions → `G1w` self header。空列表：messagingDisabled → `p5i`；无 self → `"No reachable agents."`；有 self 无 peer → 长句 `No reachable agents — no other Claude session…`。

本地 `ListPeersTool.formatPeersListing` **已有**：

- `"No reachable agents."`
- `NO_OTHER_SESSION_ON_MACHINE` 长句
- `Peer sessions (n):` 横幅
- `G1w` self header（`formatOwnSessionListing`）
- `Z1w` teammates（`formatTeammatesSection`）

测：`listAgentsOwnName.239.test.ts` / `listAgents.teammates.239.test.ts`。

**HAVE（2026-09-01 功能对齐）：** 节序 `J1w` → `Z1w` → `Q1w`。`MHm`=`listSubagentsForListing`（`local_agent` 且 `agentType!=="main-session"`；名撞队友则藏 name）。`Eao`=`formatListingRow` 给 Subagents / Teammates / Peer sessions 共用。`GCe` analog = `buildListingCandidateMap`（teammate + subagent + uds/cloud/bridge 一个 `pYb` 池）；peer `[ref]` 是 hex，不是 address。仅 Subagents/Teammates 时不刷空 Peer sessions 横幅。

**仍 invent-ban：**

| 符号 | 为何不造 |
| --- | --- |
| DID / `p5i` | 无 did 分组 / messagingDisabled 文案 host |
| `$Hm` / `$_a` formerNames / heldNames | 无 `QV` / formerNames host；继续 `getCurrentSessionTitle` |
| `$t()` team sidecar | `_O` 仍磁盘 `readTeamFileAsync` |

#50/#51 HAVE 不因此降级。测：`listAgents.subagents.239.test.ts` / `listAgents.offline.229.test.ts` / `listAgentsOwnName.239.test.ts` / `listAgents.teammates.239.test.ts`。

## bvr — `/config` Settings 组件

官方 `bvr(props)` @315215378：整棵 catalog + persist。`$t()` 时 `F`/`B`/`W` 走 `ga`/`ame`/`ln(..., storageV5)`。

本地 host = `Config.tsx`。`F`/`B`/`W` 包装已有（`bvrCatalog.239.test.ts`）。有 host 的官方 id 已挂（autoCompact / tips / thinking / fast / worktreeBaseRef / workflowKeywordTriggerEnabled / modelProposedGoals 等）。

**HAVE（2026-09-01 功能对齐，按行拆）：**

| 官方 catalog id | 官方 persist | 本地 |
| --- | --- | --- |
| `recap` | `awaySummaryEnabled`（on → `undefined`，off → `false`）+ `setAppState` | schema + AppState + `/config`「Session recap」。`useAwaySummary` 在 `false` 时跳过（env force 除外） |
| `workflows` | `enableWorkflows`，门 `workflowsToggleable` | `WORKFLOW_SCRIPTS && isWorkflowsAvailable()` 时「Dynamic workflows」+ keyword。值 `disableWorkflows===true ? false : enableWorkflows ?? defaultOn` |
| `artifacts` | `enableArtifact`，门 `artifactToggleable` | `isArtifactToolRegistered()` 时「Artifacts」。无 cobalt 时通常不画行（与官方 toggleable 同） |
| `switchModelsOnFlag` | `F({switchModelsOnFlag})`；门 refusal-fallback；默认 `$c=true` | schema + `getSwitchModelsOnFlag()` + `/config`「Switch models when a message is flagged」。测：`bvrConfigRows.239.test.ts` |
| `externalEditorContext` | GlobalConfig + `/config` 常驻 | `promptEditor` `dqw`/`pqw` + `jpo` 拼 last assistant。maple → 「Show responses in IDE」否则 「Show last response in external editor」 |
| `precomputeCompactionEnabled` | 门 `tengu_sepia_moth`；默认 `LJr=!1` | schema + `/config`。`isPrecomputeCompactionEnabled()` = auto-compact + zSe/Rhe + GB + setting。**不** invent `kpw` sidecar |
| `timestamps` | `B("showMessageTimestamps")` + GlobalConfig + AppState；门 `tengu_silk_hinge` | `/config` + `MessageTimestamp` 画（`cko`/`Avs`/`jkc`）。测：`messageTimestamp.239.test.ts` |

**仍 invent-ban：**

| 官方 catalog id | 为何不造 `/config` 行 |
| --- | --- |
| `agentsView` | `disableAgentView` / env 是关闸，不是 `/config` 开 |

`$t()` persist：`saveGlobalConfig` 第二参 `_storageV5` **void**。磁盘臂已是 host。不 invent `ga`/`ame`/`ln` 云臂。

## U_c — catalog section-order

官方 `U_c` @320774343：`Wfg` 八段 × `jfg` rank，未知 id → Advanced `zfg`。

本地 `sortConfigCatalog`（`src/utils/configCatalog.ts`）1:1。`Config.tsx` ~425 只排已有行。测：`configCatalog.239.test.ts` / `mapleJr.239.test.ts`。

**HAVE。** catalog 里的 id 只定 **排序秩**。未知 / 本地-only 行（`poorMode`、`emojiCompletionEnabled`、`cacheWarningEnabled`…）走 Advanced `zfg`，保持输入相对序。`recap`/`workflows`/`artifacts` 行由 Config host 造，不是 `U_c` 因 `Wfg` 名单 invent。

## H_a — UDS auth preamble

官方 `H_a(token)` @303723100：`He({type:TWd,token})+"\n"`，`TWd="auth"`。`cmp` 在 `IWd` 拿到 token 时前缀。

本地 `serializeUdsAuthFrame`（`src/utils/udsMessaging.ts`）1:1。`udsClient` / `sendUds*` 已前缀。测：`udsAuthFrame.239.test.ts`。

**HAVE。** `udsClient` 文本发送 + `udsMessaging` 直发都前缀。`sendUdsControl` 走 `udsClient`（token 有才前缀，对齐 `cmp`/`IWd`）。08-25「不 invent preamble」过期。

## comment census — 官方无 Ink 面板

官方 CLI **0** 「Watch status」hits。可见面是 Artifact `status` tool_result 文案（`r1w`）+ connected watch 上的 `n1w` JSON。`fvl`/`ADw` 是 live socket sender，不是终端控件。

**HAVE（2026-09-01）：**

| 符号 | 本地 |
| --- | --- |
| `Y_r` | `CLAUDE_CODE_ARTIFACT_COMMENTS ?? tengu_teal_corbel`（不是 `Gso` autoreact） |
| `M3i` / `jso` / `lTm` / `t1w` | `supervisors.ts` + `commentCensus.ts`。`t1w` 3s（`ZRm`）。`comments` 成功后 `lTm`（有 `agentId` 的 subagent 不记） |
| `n1w` | 只铺 connected 行：`unread_plain_comments` / `summons_awaiting_reply` / `comments_uncounted` / `comments_partially_counted` |
| `r1w` | `formatCommentCensusStatusClause` → `formatArtifactWatchStatus`；`mapToolResult` 与 Ink 工具结果共用 |

测：`commentCensus.239.test.ts`。不 invent footer chip / Watch 面板 / `kpw` / `readArtifactForModel`。

## #44 En_ / #56 Ohu — 本机生产路径

**#44 HAVE。** `createCriPolicyPrecheck` = 官方 `En_(e)`：`cri.enabled` + `policy.webhook` 才 POST；`block:true` → `APIError(400, policy_blocked)` + `x-should-retry:false`。生产路径是 Anthropic SDK `buildFetch`（`criPolicyPrecheckFetchInput`）：无 webhook 立刻 return（不 parse body）；有袋才读真实 `path`/`query`/`headers`/`body`，gzip 之前。无 leftover `.precheck(` 调用点；**不是**所有 `withRetry`。官方也无本地 `cri` writer（passthrough settings / 测试注入）；无袋 no-op = 对齐，不是缺口。不造第二套 webhook host / 新 zod key / 新 env。测：`criPolicyWebhook.239.test.ts`。

**#56 HAVE。** `NO_PROXY_COMMON`=`Ohu`（只 API / staging / mcp-proxy）；`isAnthropicHost`=`c0T`。CCR `upstreamproxy` 用 `NO_PROXY_EMBEDDED`=`G1s`，www/docs/apex 走现有 relay。官方 `KFy` 是 hosted agent-proxy MITM；本地对等是 `startUpstreamProxyRelay`。同缺第二套 MITM = 对齐，不另造。测：`noProxy.239.test.ts`。

**234 #35 HAVE。** 过期 `oRr` → `IbE` / `HbE`（implicit 写 `Run /login`）。`/login` 是 `ConsoleOAuthFlow`（claude.ai OAuth）。changelog 不是 profile 铸造页。

## uea / HR0 — leftover 无定义

leftover `H_s` 只有调用点：`uea(()=>p(f=>f+1))`、`setTimeout(..., alreadyFetched?HR0:0)`。抽出金标无函数体、无毫秒数。抽出金标已接：第一参 `e`=`snapshotSequence` + 首次 delay 0。**HAVE（同缺）。** leftover 无体 = 已对齐，**禁止**当 tip 缺口 / 待办。不造文件监听或 debounce。

## xCs — `initialDetailTaskId`

官方 `if(r) return {mode:"detail",itemId:r}`，**不**走 `t5c`。detail switch 无 `monitor_ws` case，落到列表 JSX；`onKeyDown` 仍 `f.mode!=="list"` 直接 return。与 tip 同。**KEEP。** 不 invent t5c 门 / MonitorWs detail。
