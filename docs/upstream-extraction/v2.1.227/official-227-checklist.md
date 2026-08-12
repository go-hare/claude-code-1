# densable 2.1.227 — 官方更新清单 × go-hare 对照

> 来源：官方 2.1.227 release notes（`changelog-2.1.227.md`，**5 条**）。  
> densable 二进制 SEA：`/tmp/official-227/plat/package/claude`（darwin-arm64）；`// Version: 2.1.227` HIT ×6；size **285046400**；sha256 `7432511ba3be818e01f23f6eef8630d214a8b618451e188c3c7d61a987eef6c7`。  
> 基线：本地 tip densable **2.1.225**（`814ff6dc`）+ **2.1.226 NOOP**。**本 pack 只对齐 2.1.227**。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN** · **NOOP**  
> 约定：**extract densable first → 1:1**。不自动 commit/push/bump。不 invent cloud/VSCode-only。  
> 更新：2026-08-12 — SEA extract + 产品落地 #1–#5（#4 slash 菜单 wZt/Zsm/tam 已 1:1）。

## 邻版关系

| 版 | 性质 | go-hare |
| -- | ---- | ------- |
| **2.1.225** | gateway spend / agents trust / OAuth / RC pin / CCR tip 等 14 条 | tip `814ff6dc`（HAVE 13 · N/A 1 VSCode） |
| **2.1.226** | opaque reliability stamp | **NOOP** |
| **2.1.227** | 5 条：GB pre-init OAuth / SCRUB force default / `/tui` empty resume / slash menu / async FS | **本 pack** |
| **2.1.228+** | 18 条 | 勿折入 |

## densable 关键符号（SEA 锚）

| 符号 / 字符串 | 含义 | 状态 |
| --- | --- | --- |
| `GrowthBook: pre-init OAuth refresh failed` | createClient 5s OAuth pre-init | 227-only vs 226 |
| `GrowthBook: auth header resolution failed` | getAuthHeaders throw → no auth | HIT |
| `iTu` + SCRUB force default notification | permission mode default under scrub | HIT（226 亦有字符串；本地此前未落地） |
| `CLAUDE_CODE_MEMORY_API_TOKEN` in R_s | scrub list 227 delta | HIT（226: 0） |
| `CLAUDE_CODE_ARTIFACTS_API_TOKEN` / `ANTHROPIC_FOUNDRY_AUTH_TOKEN` | densable R_s peers | HIT → 本地 scrub 补齐 |
| `async function kmt` + `findSimilarFile failed for` | async readdir similar-file | HIT |
| `freshIfNoTranscript&&!await d2p` / `transcriptHasBytes` | empty transcript skip resume | HIT |
| `rewound:!0` / `tengu_rewind_first_message` | rewind-before-first-message | HIT（226 亦有；#3 修的是 relaunch 误 resume） |

## 条目对照（5）

| # | 官方要点 | 判定 | 本地证据 / densable 金标 | 备注 |
| - | -------- | ---- | ------------------------ | ---- |
| 1 | Feature flags without subscription tier on expired login token → wrong Max/Fable usage-credits prompt | **HAVE** | densable `createClient`: `await Al(refreshOAuthTokenIfNeeded(), 5000, "timeout")` then attributes; local `initializeGrowthBook` pre-init via `withTimeout(checkAndRefreshOAuthTokenIfNeeded(), 5000, "timeout")` + `resetUserCache` + recreate client; log labels in `growthbookAuthRefresh.ts` | 不 invent remote-eval 以外路径 |
| 2 | Every Bash failing under `claude-code-action` + `allowed_non_write_users` on GHA runners | **HAVE** | densable `iTu` early return `mode:"default"` + notification; local `initialPermissionModeFromCLI` SCRUB force; scrub list + `CLAUDE_CODE_MEMORY_API_TOKEN` / ARTIFACTS / FOUNDRY_AUTH | Bash 失败根因是错误 permission mode + scrub，不是 scrub 列表 alone |
| 3 | `/tui` restoring conversation rewound before first message | **HAVE** | densable `nGe`/`xnr`: `freshIfNoTranscript&&!await d2p`; local `resolveRelaunchCliArgs` + `transcriptHasBytes` + FullscreenUpsellDialog 不再 hardcode `hasNonEmptyTranscript:true`; `LastPromptMessage.rewound` + `recordForkBoundaryLeaf(..., {rewound})` | 本地 `/tui` 默认 inject-only；spawn 路径与 densable 对齐 |
| 4 | Slash-command menu: blue only selected row; bold matched chars; emoji/accented glyphs | **HAVE** | densable `Zsm`/`tam`/`wZt` + footer `kh.query`；local `findQueryMatchRanges` + `expandMatchRangesToGraphemes` + `QueryHighlightedText`；`createCommandSuggestionItem` 挂 `query`；footer 名/描述列 bold match not recolor；`toLowerCase` length guard + grapheme expand (`/[^ -˿]/` + Segmenter) | 226→227 金标：match 段由 recolor→bold；emoji 建项 densable 不带 query（与 ewv 一致） |
| 5 | Perf: fewer event-loop stalls on file-not-found suggestions and at-mention size checks | **HAVE** | densable `kmt` async readdir; local `findSimilarFile` → `await fs.readdir`; `isFileWithinReadSizeLimit` → `await fs.stat`; callers awaited | gitDiff / attachments 同步调用点已 await |

## 计数（2026-08-12）

| 状态 | 条数 | 条目 |
| ---- | ---- | ---- |
| **HAVE** | **5** | **#1 #2 #3 #4 #5** |
| **PARTIAL** | **0** | — |
| **GAP** | **0** | — |
| **UNKNOWN** | **0** | — |
| **N/A** | **0** | — |
| **NOOP** | **0** | — |

## 验证（本轮）

- SEA pack + anchors under `docs/upstream-extraction/v2.1.227/snippets/`
- Product:
  - `src/services/analytics/growthbook.ts` pre-init OAuth
  - `src/utils/growthbookAuthRefresh.ts` log formatters
  - `src/utils/permissions/permissionSetup.ts` SCRUB force
  - `src/utils/subprocessEnv.ts` scrub list delta
  - `src/utils/file.ts` async findSimilar + size limit
  - `src/utils/sessionStorage.ts` `transcriptHasBytes` + rewound last-prompt
  - `src/components/FullscreenUpsellDialog.tsx` transcript probe
  - #4: `queryMatchRanges.ts` (Zsm/tam) · `QueryHighlightedText.tsx` (wZt) · footer + `commandSuggestions` query
- Tests: `growthbookAuthRefresh.214` · `subprocessEnvScrubForce.227` · `transcriptHasBytes.227` · `findSimilarFile.async.227` · `queryMatchRanges.227` · `commandSuggestionQuery.227`

## 明确不做

- 不 invent CustomSelect `highlightedText` 当 slash footer（footer 金标是 `wZt`/`Zsm`/`tam`）
- 不 invent emoji `ewv` 挂 `query`（densable 不挂）
- 不把 **2.1.228** 折入本 pack
- 不 commit / bump / push，除非用户明确要求

## SEA 工件

```
/tmp/official-227/plat/package/claude
docs/upstream-extraction/v2.1.227/snippets/sea-meta.txt
docs/upstream-extraction/v2.1.227/snippets/gb-client-factory.txt
docs/upstream-extraction/v2.1.227/snippets/allowed_non_write_users.txt
docs/upstream-extraction/v2.1.227/snippets/subprocess_scrub.txt
docs/upstream-extraction/v2.1.227/changelog-2.1.227.md
docs/upstream-extraction/v2.1.227/official-227-checklist.md
```
