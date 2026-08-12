# densable 2.1.225 — 官方更新清单 × go-hare 对照

> 来源：官方 2.1.225 release notes（`changelog-2.1.225.md`，**14 条**）。  
> densable 二进制 SEA：`/tmp/official-225/plat/package/claude`（darwin-arm64）；`// Version: 2.1.225` HIT ×6；size **279661952**；sha256 `08d6e85dd2b80883bb8da93cbeae3dc79b4704d6b84a05d614bf1ff4a5155b69`。  
> 基线：本地 tip densable **2.1.224** 分批提交收口（`6ec40f7f`，HAVE 29/31）。**本 pack 只对齐 2.1.225**。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN**  
> 约定：**extract densable first → 1:1**。不自动 commit/push/bump。不 invent cloud/VSCode-only。  
> 更新：2026-08-12 — #1–#9/#11/#13/#14 HAVE；**#10 CCR tip + delta rehydrate** 落地（HAVE）；#12 N/A；typecheck 定向 0；`ccrTipDelta.225` 9 pass。

## 邻版关系

| 版 | 性质 | go-hare |
| -- | ---- | ------- |
| **2.1.224** | SHR / cross-session / archive / sandbox mask 等 31 条 | tip `6ec40f7f`（HAVE 29 · N/A 2 VSCode） |
| **2.1.225** | gateway spend / agents trust / OAuth keep env / SendMessage RC by name 等 **14 条** | **本 pack** |
| **2.1.226+** | 勿折入 | — |

## densable 关键符号（SEA 锚）

| 符号 / 字符串 | 含义 | 状态 |
| --- | --- | --- |
| `// Version: 2.1.225` (×6) | 版本锚 | HIT |
| `OAuth 401: keeping the user-supplied CLAUDE_CODE_OAUTH_TOKEN…` | #3 fail-closed keep env token | SEA HIT · local **HAVE** (`auth.ts`) |
| `[keychain] read failed; serving stale cache` / `readAsync failed; not caching a null` | #4 keychain timeout | SEA HIT · local **HAVE** (`macOsKeychainStorage.ts`) |
| `cannot create or write to base directory …` + `ensureBaseDirWritable` | #9 SHR startup gate | SEA HIT · local **HAVE** (`rootRunner.ts` / `izh`) |
| `name [ref]` / `pinnedIdentityClaimedLocally` / `NOT on this machine` | #13/#14 SendMessage RC identity pin | SEA HIT · local **HAVE** (`nameResolve.ts` + AppState pins) |
| ListAgents proactive RC-by-name（非 reply-only） | #13 | local **HAVE** (`ListPeersTool/prompt.ts`) |
| headless `onHeld` + `dialogExpiry` expire | #6 | local **HAVE** (`cli/print.ts`) |
| `refusedBySafeguard` / HSa refused copy | #5 auto mode circuit | local **HAVE** (`yoloClassifier` + `permissions` + `messages`) |
| `D_r(e)=e\|\|Kn()==="gateway"\|\|w$t()` / `b7u` skip gateway cache / spend body | #1 gateway spend | SEA HIT · local **HAVE** (`rateLimitMocking` + `claudeAiLimits` + `errors`) |
| `XKu` / `is_image` / `prependImageBlocks` / `bridge_attachment_inline_image` | #11 RC photos | SEA HIT · local **HAVE** (`inboundAttachments.ts`) |
| `jCt`/`oHr`/`qCt`/`Dtf` + `Skipping compact-pair upload` | #7 RC resume after compact | SEA HIT · local **HAVE** (`sessionStorage` + bridge `noHistoryBackfill`) |
| AgentView dispatch spawn `getCwd()`（非 hover session.cwd） | #8 agents hover cwd | local **HAVE**（无 setCwd/chdir on selection） |
| `Etf`/`wtf`/`Ctf`/`J0a`/`Dsi`/`Q0a` + `after_event_id` / `.ccr-tip.json` | #10 web stuck backlog | SEA HIT · local **HAVE** (`sessionStorage` tip + delta hydrate + `CCRClient`/`RemoteIO`) |
| Focus view / Thought for | #12 VSCode | N/A |

## 条目对照（14）

| # | 官方要点 | 判定 | 本地证据 / densable 金标 | 备注 |
| - | -------- | ---- | ------------------------ | ---- |
| 1 | gateway spend-limit usage warning（cap / reset / operator message） | **HAVE** | `shouldProcessRateLimits` = subscriber \|\| gateway \|\| mock（densable `D_r`）；`cacheExtraUsageDisabledReason` skip gateway（`b7u`）；`extractQuotaStatusFromError` skip gateway 无 unified-status（`fxo`）；`getAssistantMessageFromError`：无 claim/overage-status 但有 `overage-disabled-reason` 时 **直接 surface body**（`spend limit reached (period; resets …) — operator`） | gold: `snippets/gold-gateway-spend-precheck.js` + SEA `D_r`/`b7u`/`fxo`/errors 429 分支 |
| 2 | `claude agents` 未信任目录 workspace trust | **HAVE** | `src/cli/agentsTrust.tsx` + `agents.ts` 在 `renderAgentView` 前 `ensureAgentsWorkspaceTrust`；单测 `agentsTrust.225.test.ts` | FXv / TrustDialog short-lived Ink root |
| 3 | 401 勿用 stored 短 token 覆盖长寿 `CLAUDE_CODE_OAUTH_TOKEN` | **HAVE** | `handleOAuth401ErrorImpl`：`keepUserSuppliedEnvToken` 时 **不**写 env；log SEA 文案；`oauth_401_skipped_user_env_token` | headless 正确性 |
| 4 | macOS keychain 超时后 MCP OAuth 401 风暴 | **HAVE** | sync stale-while-error + async `not caching a null` + `KEYCHAIN_READ_FAILURE_COOLDOWN_MS` 冷却 | 不写 null 清会话 |
| 5 | auto mode：safety-filter 拒绝不计入 consecutive-block | **HAVE** | `stop_reason==="refusal"` → `refusedBySafeguard`；`countsAsDenial` 排除；HSa refused copy；headless AbortError | 仍 deny，但不 +1 counter |
| 6 | headless/startup 跨会话 hold 无 notice/expiry | **HAVE** | `print.ts`：`onHeld` dialogExpiry expire + hold-receipt log + settings `crossSessionInbound` re-eval | 224 #5 residual 的 headless 面 |
| 7 | RC resume 大会话 compact 后 history 坏 | **HAVE** | densable `oHr&&jCt` skip compact-pair remote upload under `noHistoryBackfill`；`persistToRemote` log SEA 文案；`registerLiveSuppressionProbe`/`isCompactPairWithheldFromRemote`；mint-after-gone → `handle.noHistoryBackfill` + `saveBridgeSession(..., true)` | gold: `snippets/gold-rc-compact-pair-withhold.js`；单测 `compactPairWithhold.225.test.ts` |
| 8 | agents list hover 别项目改 next agent cwd | **HAVE** | `AgentView` dispatch/spawn 一律 `getCwd()`（`cwd: getCwd()` / `parsed.cwd ?? getCwd()`）；selection 仅展示 `selectedSession?.cwd`，**无** `setCwd`/`chdir`/`setOriginalCwd` on hover | 无 process cwd 污染；next agent 跟 host cwd |
| 9 | SHR `--base-dir` 不可写则 **启动即 exit** | **HAVE** | `ensureBaseDirWritable` 在 register 前；超时 exit(1)；其它 throw→exit(2)；测试用可写 tmp baseDir | densable `izh` |
| 10 | web session 误 stuck + reconnect 重放 backlog | **HAVE** | densable CCR tip sidecar + delta rehydrate：`.ccr-tip.json`；`getValidatedCCRTip`（`client-gated`/`no-sidecar`/`tip-not-in-tail`）；`updateCCRTipFromAckedBatch` on internal-events ack；`readInternalEvents(after_event_id)`；`hydrateFromCCRv2InternalEvents` tip 命中则 append delta 否则 full rewrite；GB `tengu_ccr_delta_rehydrate` / `tengu_ccr_subagent_skip_on_delta`；RemoteIO `hydratePrefetch` + print 接线 | gold: `snippets/gold-web-ccr-tip-delta.js`；单测 `ccrTipDelta.225.test.ts` |
| 11 | RC 照片直接给模型（非再 Read 磁盘） | **HAVE** | `inboundAttachments.ts` densable 1:1：`is_image`+无 `sha256` → `XKu` 式 image block；`resolveInboundAttachments`→`{prefix,imageBlocks}`；`prependImageBlocks`；`resolveAndPrepend(msg,content,allowInline?)`；30MiB/16 cap；integrity SendFile notices | gold: `snippets/gold-rc-photos-inline.js`；单测 `inboundAttachments.225.test.ts` |
| 12 | [VSCode] Focus view fold / Thought for Ns | **N/A** | VSCode 扩展 only | invent-ban |
| 13 | SendMessage **可按名主动**开聊 RC（ListAgents `name [ref]`） | **HAVE** | ListPeers prompt 去掉 reply-only；SendMessage bare-name / `name [ref]` peer resolve + bridge send；`nameResolve.225.test.ts` | UDS_INBOX feature gate |
| 14 | 已确认 RC 收件人不可被本机同名会话顶替 | **HAVE** | `sendMessagePins` + `resolvePeerByName` pin guard / `pinnedIdentityClaimedLocally` refuse；**NKp 仅 bare-name 成功路径**（`cand.name`）；显式 `uds:`/`bridge:` **不** pin（SEA 仅 2 处 `NKp(…,p.displayName,…)`） | 与 #13 同簇 |

## 计数（2026-08-12）

| 状态 | 条数 | 条目 |
| ---- | ---- | ---- |
| **HAVE** | **13** | **#1 #2 #3 #4 #5 #6 #7 #8 #9 #10 #11 #13 #14** |
| **PARTIAL** | **0** | — |
| **GAP** | **0** | — |
| **UNKNOWN** | **0** | — |
| **N/A** | **1** | **#12** VSCode |

## 验证（本轮）

- `bun run typecheck` → **0 errors**
- `ANTHROPIC_API_KEY=test-key bun test` 定向：
  - `inboundAttachments.225` + `gatewaySpendLimit.225` + `rateLimitMessages.individualSpend.221` + `compactPairWithhold.225` + **`ccrTipDelta.225` (9 pass)**
- 全量 suite 基线污染仍在，与 225 无直接相关

## 本轮实现要点

### #11 RC photo inline（`src/bridge/inboundAttachments.ts`）

- Schema：`file_uuid`/`file_name`/`is_image?`/`sha256?`/`file_size?`
- Cap：`qpe=31457280`、`Uee=16`
- `is_image===true && sha256===undefined` → detect magic + resize → image content block；失败 fallback `@path`
- Peer SendFile（有 sha256）失败时 surface `[SendFile: … was not delivered — …]`
- `resolveAndPrepend(msg, content, allowInline=true)`；slash-command content 禁 inline
- **SEA 钉死**：schema `sha256:N().nullish().catch(null)`；inline/chrome-digest 条件是 **`=== void 0` 不是 truthiness**。坏 sha 经 catch 成 `null` 后 **不** inline（与 densable 1:1；勿改成 `!sha256`）

### #1 gateway spend-limit client

- `rateLimitMocking.shouldProcessRateLimits`：`isSubscriber || gateway || mock`（`D_r`）
- `claudeAiLimits.cacheExtraUsageDisabledReason`：gateway 不写 cache（`b7u`）
- `extractQuotaStatusFromError`：gateway 且无 `unified-status` 则 return（`fxo`）
- `errors.getAssistantMessageFromError`：无 claim/overage-status 但有 `overage-disabled-reason` → **body message as content**（gateway spend precheck 形状）

### #7 compact-pair withhold（RC resume after large compact）

- densable `persistToRemote`：`oHr(t)&&jCt()` → skip upload with SEA log
- Local：`isCompactPairEntry` / `isCompactPairWithheldFromRemote` / `registerLiveSuppressionProbe`
- mint-after-gone：`remoteBridgeCore.noHistoryBackfill = skipInitialHistoryFlush`
- `useReplBridge`：`saveBridgeSession(..., noHistoryBackfill)` + live probe on connect / clear on teardown

### #8 agents list hover cwd

- `AgentView` spawn/dispatch uses host `getCwd()`；hover selection only displays path — no process cwd mutation

### #10 CCR tip + delta rehydrate（web stuck backlog）

- `.ccr-tip.json` sidecar：`readCCRTip` / `writeCCRTip` / `getCCRTipPathForSession`
- `getValidatedCCRTip`：`client-gated` / `no-sidecar` / `tip-not-in-tail`
- `updateCCRTipFromAckedBatch` ← `CCRClient.onInternalBatchAcked` after internal-events POST ok
- `CCRClient.readInternalEvents(after_event_id?)` + paginatedGet anchorFallback
- `hydrateFromCCRv2InternalEvents`：tip 命中 local tail → append delta；否则 full rewrite；GB gates
- `RemoteIO.hydratePrefetch` when `--resume`；`print.ts` 传入 Q0a

## 审查 residual（SEA 对照后）

| 项 | 结论 |
| -- | ---- |
| 显式 `uds:`/`bridge:` pin key | **已对齐 densable**：scheme 路径不调 `NKp`；仅 bare-name `cand.name` pin |
| `sha256: null` vs `=== undefined` | **1:1 densable（不修 truthiness）**：schema `nullish().catch(null)`；inline/chrome `===void 0`；坏 sha → null → 不 inline；正常缺字段 `undefined` 仍 inline。单测 `bad sha256 catch(null) does not inline` |
| agentsTrust 仅 project/local allow 面 | HAVE 可接受；完整 densable `abn/Ypt/yde` 更宽/更窄时再补，**不 invent** |
| `qvt` / looksLikeSlashCommandContent | **已对齐 SEA**：检的是 **`<cross-session-message`**（DEe）+ `_je` 三前缀，**不是** slash `command-name`；历史 export 名保留 |

## 建议后续（可选）

1. 全量 suite 基线污染单独治理  
2. commit / bump 仅当用户明确要求  

## 明确不做

- 不折入 **2.1.226–228**  
- 不 invent VSCode Focus（#12）  
- 不 commit / bump / push，除非用户明确要求  

## SEA 工件

```
/tmp/official-225/plat/package/claude
/tmp/official-225/sha256.txt
docs/upstream-extraction/v2.1.225/snippets/sea-meta.txt
docs/upstream-extraction/v2.1.225/snippets/gold-rc-photos-inline.js
docs/upstream-extraction/v2.1.225/snippets/gold-gateway-spend-precheck.js
docs/upstream-extraction/v2.1.225/snippets/gold-rateLimitMessages-minified.js
docs/upstream-extraction/v2.1.225/snippets/gold-rc-compact-pair-withhold.js
docs/upstream-extraction/v2.1.225/snippets/gold-web-ccr-tip-delta.js
docs/upstream-extraction/v2.1.225/snippets/gateway-protocol-225.md
```
