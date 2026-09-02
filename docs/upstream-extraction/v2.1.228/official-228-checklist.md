# densable 2.1.228 — 官方更新清单 × go-hare 对照

> 来源：官方 2.1.228 release notes（`changelog-2.1.228.md`，**18 条**）。  
> densable 二进制 SEA：`/tmp/official-228/plat/package/claude`（darwin-arm64）；`// Version: 2.1.228` HIT ×6；size **289298144**；sha256 `43484b1352cef03a08346f36ef0437755b1aad646ab9313ce187857b794b7247`；vs 227 **+4 251 744**。  
> 基线：本地 tip densable **2.1.227**（`1a88f3cc`，HAVE 5/5）。**本 pack 只对齐 2.1.228**。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN** · **NOOP**  
> 约定：**extract densable first → 1:1**。不自动 commit/push/bump。不 invent cloud/VSCode-only。  
> 更新：2026-09-01 — 口径「本地对齐即 HAVE、云端不管」。#12 harden core → **HAVE**（18 / PARTIAL **0**）。claude.ai ingest 不管。此前：2026-08-13 core-only 曾标 PARTIAL。**已 commit**（`3d43480c` 起 228 对齐）。

## 邻版关系

| 版 | 性质 | go-hare |
| -- | ---- | ------- |
| **2.1.226** | opaque reliability stamp | **NOOP** |
| **2.1.227** | GB OAuth / SCRUB / `/tui` empty / slash menu / async FS | tip `1a88f3cc`（HAVE 5/5） |
| **2.1.228** | 18 条：layout hang / Windows git / SHR / plugins / skills / … | **本 pack** |
| **2.1.229+** | 未提取 | 勿折入 |

## densable 关键符号（SEA 锚）

| 符号 / 字符串 | 含义 | 本地 |
| --- | --- | --- |
| `ink layout pass threw; recovered by immediate re-layout` | layout 故障恢复 | **HAVE** `packages/@ant/ink/src/core/ink.tsx` |
| `reportLayoutFaultToErrorTracking` / `reportLayoutFaultRecovered` | layout fault 上报 | **HAVE** |
| `function uio` + cwd/parent 过滤 | Windows `where.exe` 路径过滤 | **HAVE** `windowsPaths.ts` + `uio.228.test.ts` |
| `function hVg` / `gitBashPath` | Git Bash 发现 | 本地 `findGitBashPathOrNullWithDeps` |
| `[runner:warn] checkout hook failed for context source` + `no push_targets` | SHR 非 work repo hook 失败跳过 | **HAVE** `sessionHandler.ts` |
| `releasing the follow-up hold` / `session still counted as busy` | SHR bg→follow-up grace | **HAVE** `sessionActivity.ts` |
| `Not marking a symlinked plugin version` | plugin cache 不标记 symlink 开发版 orphan | **HAVE** `cacheUtils.ts` |
| `Failed to publish the inbox auth key` / `key_publish_failed` | UDS inbox 启动硬失败 | **HAVE** `udsMessaging.ts` + `CLAUDE_CODE_MESSAGING_TOKEN` |
| `Jqy` legacy model set + Write `guardSkipped` via `!J4t(d)&&MCt(...)` | Write 新模型可 skip 未读 gate | **HAVE** `fileEditReadGate.ts` |
| `GmE="Sessions are slightly more expensive."` + `R9h=\`${w9h} ${C9h}\`` | Pro/Max/Team 首启去掉 expensive 句 | **HAVE** `AutoModeOptInDialog` `WITHOUT_COST` |
| `synced from claude.ai loaded but never invoked` | doctor 文案（可选） | doctor UI 可选；**harden core HAVE** |
| `Retrying in` + Spinner compact 分支 | compaction 期间 retry/stall UI | **HAVE**（#15） |
| `ssn` / `tRe` marketplace whole-entry | higher tier 不继承 lower `headers` | **HAVE** `settingsMergeCustomizer` |
| `KKd`/`YKd` + `x6S=2` GCP auth cap | Vertex fail-fast | **HAVE** `errors.ts` / `withRetry.ts` |
| `Vyn`/`ULo`/`xTt`/`$vr`/`bDo` | synced skill harden | **HAVE** `syncedSkillsHarden.ts`（core；ingest 不管） |
| `Bxa`/`cui` + `--model` pin | `/tui` relaunch 保留 model override | **HAVE** `cliRelaunch.ts` `resolveRelaunchModelArg` |
| `I6y`/`fbr`/`Tte`/`lhm` + `from-name` | cross-session sender = RC session name | **HAVE** `crossSessionMessage.ts` |
| `q5o`/`EAt` + `NO_BACKFILL`/`OWNER_*` | RC reattach owner mismatch forces history suppress | **HAVE** `resolveBridgeReattachOwnerMeta` + `buildBridgeReattachEnv` + init consume |
| `St` mid-turn：`attachment → toolResults.push`（227 仅 `read_truncation_notice`） | skill `deferred_tools_delta` 进入 mid-turn history scan | **HAVE** `accumulateToolResultForMidTurn` |
| `szi=["\\u25D0","\\u25D1"]` / 227 `nUi=["\\u2802","\\u2810"]` | title busy spinner frames ◐/◑ | **HAVE** `TITLE_ANIMATION_FRAMES` |

## 条目对照（18）

| # | 官方要点 | 判定 | 本地证据 / densable 金标 | 备注 |
| - | -------- | ---- | ------------------------ | ---- |
| 1 | Interactive session stop redrawing after rare layout error | **HAVE** | `ink.tsx` `reportLayoutFaultToErrorTracking` + immediate re-layout + recovered/dropped | 2.1.228 落地 |
| 2 | `git` / Git Bash not found when launched from parent of git install (Windows) | **HAVE** | densable `uio` in `windowsPaths.ts`；`windowsPaths.uio.228.test.ts` | parent-of-install 放行 |
| 3 | `/tui` reverts to earlier model after `/model` changed | **HAVE** | densable `Bxa`/`cui`：relaunch `extraArgs` 含 `--model` from `mainLoopModelOverride`（null→`default`；skip mantle/deprecated/refusal latch）；本地 `resolveRelaunchModelArg` + `mergeRelaunchModelArgs` 接入 `buildTuiRelaunchPlan`；`/tui` on/off 走 `acceptTuiRelaunch` | `cliRelaunch.test.ts` Bxa cases |
| 4 | Cross-session messaging starts without inbox first session after install/upgrade | **HAVE** | `udsMessaging.ts` `key_publish_failed` 拒绝启动 + `CLAUDE_CODE_MESSAGING_TOKEN` 导出 | 228 启动硬失败语义 |
| 5 | Remote Control `/resume` while connected leaks title/history into connected session | **HAVE** | densable `q5o`/`EAt`：owner id≠bridge → force `noHistoryBackfill`；env `OWNER_ACCT`/`OWNER_ORG`/`NO_BACKFILL`；`initReplBridge` 消费 + owner mismatch mint-fresh；`remoteBridgeCore` `noHistoryBackfill` 强制 skip history flush；**mint-after-gone** densable `Pe=c??slug` → `neutralFallbackTitle`；**C1**：`saveBridgeSessionMeta` 同 bridge 部分写（skipArchive 仅 seq/grouping）**merge** 保留 `noHistoryBackfill`/owner/dialogKinds，换 bridge id 全量替换不继承 | `bridgeReattach.test.ts` q5o/EAt + skipArchive-style CXr merge；`flushHistorySkipAfterMint.224.test.ts` Pe=c |
| 6 | SHR: checkout hook fail on non-push context repo → skip + warn | **HAVE** | `sessionHandler.ts` `[runner:warn] checkout hook failed… no push_targets` | tests in `sessionHandler.failure.224.test.ts` |
| 7 | SHR: end session in gap between bg task finish and follow-up turn | **HAVE** | `sessionActivity.ts` follow-up hold / `releasing the follow-up hold` / `session still counted as busy` | #7 tests |
| 8 | Session cleanup deletes contents inside project memory folder | **HAVE** | `cleanup.ts` `PROJECT_LEVEL_RESERVED_ENTRIES` (`memory`/`tiny_memory`/…) + `isProjectLevelReservedEntry` | `cleanup.memory.228.test.ts` |
| 9 | Plugin-cache cleanup deletes sole symlinked dev checkout version | **HAVE** | `cacheUtils.ts` `Not marking a symlinked plugin version` + `lstat` (YEt/Mst/o5b/s5b) | `pluginSymlinkOrphan.228.test.ts` |
| 10 | Marketplace entry higher tier inherits other tier custom headers | **HAVE** | `settings.ts` `settingsMergeCustomizer` → `ssn` whole-entry for `extraKnownMarketplaces` | `settingsMergeCustomizer.228.test.ts` |
| 11 | Deferred-tools reminder sent twice after skill invocation | **HAVE** | densable `St`：tool update 后 **全部 attachment** 原样进 `toolResults`（227 仅 `read_truncation_notice`）；skill `newMessages` 的 `deferred_tools_delta` 进入 mid-turn `getAttachmentMessages` history → 不再二次 announce | `accumulateToolResultForMidTurn` + `.228.test.ts`；`query.stWiring.228.test.ts`（query 双接线） |
| 12 | Harden claude.ai synced skills (no shadow local/MCP；sanitize；no `!`/`@` on machine) | **HAVE** | `syncedSkillsHarden.ts` Vyn/ULo/xTt/$vr/bDo；`createSkillCommand` wipe+strip shell；`getCommands` shadow filter；`skipAtMentions` | 本地 harden 1:1。claude.ai ingest host **不管 / 不 invent**。生产不写 `loadedFrom:'syncedSkills'`（仅单测构造）。 |
| 13 | Cross-session: sender+body inline；RC other-machine shows RC session name as sender | **HAVE** | densable `I6y`/`fbr`/`Tte`/`lhm`：UI `from-name` 优先；UDS/bridge send 包 envelope + `getCurrentSessionTitle` as from-name；`UserCrossSessionMessage` inline | `crossSessionMessage.228.test.ts` |
| 14 | Vertex: expired/missing GCP creds fail within seconds not minutes | **HAVE** | `KKd`/`YKd` + Cre；cap=2；文案门：`provider==='vertex'` **或** `USE_ANTHROPIC_GOOGLE_CLOUD`；**ugi 仍只 401**。**cousin GKd/VKd**：Bedrock/AWS/mantle 401·403·CredentialsProviderError → `formatBedrockAuthErrorMessage`（常量此前仅 Cre；现接线 `getAssistantMessageFromError`） | `vertexAuthFailFast` + `vertexWithRetryCap` + `bedrockAuthFailFast.228.test.ts` |
| 15 | Compaction progress: retry countdown + stall hint during compact | **HAVE** | `Spinner` / `SpinnerAnimationRow`: `retryStatus` **先于** compact progress bar（early-return 替换整行，含 progress）。**证据**：既有 Spinner 结构对齐 changelog；**非** 228 本 pack 独有 diff（2.1.214+ 能力延续） | `SpinnerAnimationRow.228.test.ts`（顺序锁） |
| 16 | Terminal title busy-spinner glyphs reduce tab jitter | **HAVE** | densable 228 `szi=["\\u25D0","\\u25D1"]`（◐/◑）；227 `nUi=["\\u2802","\\u2810"]`（⠂/⠐）；static `\\u2733` ✳ + 960ms 不变 | `REPL.tsx` `TITLE_ANIMATION_FRAMES` |
| 17 | Write: newer models overwrite unread file (match Edit rules); older still require read | **HAVE** | densable Write `!c && !ZYd && !J4t && MCt`；**Edit 亦有 skip**：`!J4t && MCt`（partial 也可 skip，**不是** “Edit 仍强制 read”）。legacy `Jqy` 两边都仍强制 prior read。**l8t Read-deny early gate**：Write/Edit `errorCode 13` + SEA 专用文案 `cannot be written/edited`（≠ generic unread）。**validateInput + call()** 同 skip（`shouldAllowCallDespiteMissingOrPartialRead`） | `fileEditReadGate.ts` + `.228.test.ts` / `.call.228.test.ts`（subprocess → `.runner.ts`）；Write/Edit `guardSkipped` + l8t + real `.call()` |
| 18 | Remove auto-mode “slightly more expensive” from first-use (Pro/Max/Team) | **HAVE** | `AutoModeOptInDialog` `AUTO_MODE_DESCRIPTION_WITHOUT_COST_SENTENCE` for pro/max/team | GmE 仍存 legacy/其他 plan |

## 计数（2026-08-12 产品落地后）

| 状态 | 条数 | 条目 |
| ---- | ---- | ---- |
| **HAVE** | **18** | **#1–#18** |
| **PARTIAL** | **0** | — |
| **GAP** | **0** | — |
| **UNKNOWN** | **0** | — |
| **N/A** | **0** | — |
| **NOOP** | **0** | — |

**合计 18 = 18 HAVE。**

## 验证（本轮）

- SEA pack + snippets under `docs/upstream-extraction/v2.1.228/snippets/`
- 产品落地：Ink layout、`windowsPaths` uio、SHR hook/hold、cleanup WMu、plugin symlink、marketplace ssn、synced skill harden、Vertex fail-fast、Write Jqy gate、AutoMode R9h、UDS key_publish
- 本续：#10 / #14 / #12 + #3 Bxa + #13 from-name + #5 q5o/EAt + #11 St + **#16 szi ◐/◑** + **#17 call-path**
- 测试：`cliRelaunch.test.ts`；`crossSessionMessage.228.test.ts`；`bridgeReattach.test.ts`；`bgWorker.test.ts`；`accumulateToolResultForMidTurn.228.test.ts`；`fileEditReadGate.228` + `fileEditReadGate.call.228`（subprocess）
- precheck：typecheck 0；#17 定向 pass；全量 suite ~310 fail 为预存基线（#17 已隔离、不贡献）
- 228 产品已在 main（`e1bfe7e5`…`3d43480c`）；工作树干净。后续 grok-4.6 catalog 为独立提交。

## Feature 默认（对齐 densable 产品面）

- **2026-08-12**：`scripts/defines.ts` `DEFAULT_BUILD_FEATURES` **打开** `UDS_INBOX` + `LAN_PIPES`（与 228 #4/#13 及 densable SEA 全量 uds-messaging 串一致）。
- 历史 pack 文案「UDS/LAN 默认 OFF」是 go-hare 工程 deferral（旧 hang 顾虑），**不是** densable 产品关；本机 smoke `startUdsMessaging` ~15ms 正常。
- **2026-08-12 续**：`TEAMMEM` + `KAIROS_CHANNELS` / `KAIROS_PUSH_NOTIFICATION` / `KAIROS_GITHUB_WEBHOOKS` 亦默认 ON（densable SEA 有产品串；本地实现已有）。mailbox 已有 MAX_*+compact，旧「无限增长」注释过时。
- **仍 OFF**：`FORK_SUBAGENT`、`ULTRAPLAN` 等（与本 pack 无关）。

## 明确不做

- 不 invent layout recover 以外的 Ink 行为
- 不 invent synced-skill 完整云同步下载 host（只 harden core）
- 不 invent 完整 densable `cui`（add-dir / effort / permission-mode）——本条 bug 金标是 **Bxa `--model` pin**
- 不把 Write skip 做成「永远允许」；金标是 **model set `Jqy` + permission MCt**
- 不 invent skill-path `inputMentionsOnly` / mid-turn dedupe 以外的 #11 补丁——金标是 **`St` attachment → toolResults**
- 不 invent #16 其它帧（金标仅 `szi` ◐/◑；static ✳ + 960ms 不变）
- 不把 **2.1.229+** 折入本 pack
- 不 auto commit / bump / push，除非用户明确要求

## 剩余 PARTIAL

— none —（#12 本地 harden HAVE；ingest 云端不管）

## 跨 pack 残差（权威表）

见 **`docs/upstream-extraction/cross-pack-residuals.md`**（2026-08-12 修正）：

- 官方 invent-ban：**223 #3 teleport**（云端面）。**221 #10 HAVE** / **#12 DEP-HAVE**（勿再当 open GAP）  
- **禁止**再写 UDS/LAN/TEAMMEM「默认 OFF」——`DEFAULT_BUILD` **ON**  
- AWS GKd/VKd **已接线**（非 open polish）；224 粗计数 **GAP 0**  
- 流程：228 pack 已在 main；勿再写「脏树未 commit」
