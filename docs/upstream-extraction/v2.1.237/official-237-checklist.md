# densable 2.1.237 — 官方更新清单 × go-hare 对照

> 来源：GitHub release **v2.1.237**（2026-08-20）+ densable SEA darwin-arm64。  
> SEA：`/tmp/official-237/plat/package/claude` · `2.1.237 (Claude Code)` · size **317110288** · sha256 `338901351d4ff17495738c67fc3e12a32c1b506738ac5e012eb782d3d8b5be43`。  
> 基线：本地 tip densable **2.1.236 已落地**（commit `d560c24e`）+ npm **2.7.45**。**本 pack 只盘点 2.1.237**（勿折入 238）。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN**  
> 更新：2026-08-21 — **#1/#2/#3 全 HAVE**；invent-ban（不 invent Proactive）；no auto commit/bump。

## Summary

| 状态 | 计数 | 备注 |
| ---- | ---- | ---- |
| **HAVE** | **3** | #1 canMarkApiSystem · #2 Concise · #3 `isOutputLineTruncated` r7/t7 |
| **PARTIAL** | **0** | — |
| **GAP** | **0** | — |
| **N/A** | **0** | — |
| **UNKNOWN** | **0** | — |

## Checklist

| # | key | 官方要点 | 状态 | 证据 |
| - | --- | -------- | ---- | ---- |
| 1 | gateway-custom-baseurl-prompt-caching | Fixed prompt caching for sessions using an LLM gateway or custom base URL | **HAVE** | **SEA `eDT`/`canMarkApiSystem` 1:1**：`shouldCacheControlOnApiSystem` = `!demote && !dje() && isApiSystemCacheControlEligible`；资格门 `FF∧rXt∧H2m \|\| (bedrock\|vertex\|mantle)∧rzi \|\| foundry∧JOT`。自定义 `ANTHROPIC_BASE_URL` / gateway **不**给 api_system 盖 `cache_control`；message-tail ephemeral 不受影响；demote 仍 reactive backup。实现：`src/utils/midConversationSystem.ts`；tests：`canMarkApiSystem.237` · `midConversationSystem` · `addCacheBreakpoints.midConv`（29 pass）。snippet：`gold-canMarkApiSystem-eDT.txt`。 |
| 2 | concise-output-style | Built-in **Concise** output style — lead with results, skip preamble/narration, same thoroughness；`/config` → Output style | **HAVE** | **SEA 237-only** 金标已 1:1：`OUTPUT_STYLE_CONFIG.Concise` + `$AT` 六规则 + `turnReminder:BAT`；attachment `wHv` 透传 `turnReminder`；messages 渲染 `` `${name} output style is active. ${turnReminder??fallback}` ``；`FOREGROUND_529` 含 `outputStyle:Concise`。**不** invent Proactive。tests：`conciseOutputStyle.237` · `outputStyleTurnReminder.237`。 |
| 3 | isOutputLineTruncated-r7 | MessagesBoundary `content.indexOf is not a function` — SEA `r7`/`t7` typeof+wrap | **HAVE** | **根因**：`Messages` → `tool.isResultTruncated(toolUseResult)`；`MCPTool` 把 **object** Output 直接丢进 tip 旧 `isOutputLineTruncated(string)` → `indexOf` 炸。**SEA 金标**（236=`t7` / 237=`r7`，非 237-only）：`if(typeof e!=="string")return!1` + newline probe on `trimEnd` + optional `terminalWidth` wrap-aware。**tip 已 1:1**：`src/utils/terminal.ts` + `isOutputLineTruncated.237.test.ts`。snippet：`gold-isOutputLineTruncated-r7.txt`。 |

## SEA Concise 金标（摘录）

```
Concise:{
  name:"Concise",
  source:"built-in",
  description:"Claude responds tersely, leading with results and skipping preamble and narration",
  keepCodingInstructions:!0,
  prompt:`… Keep your responses short and direct while doing the work just as thoroughly.\n\n# Concise Style Active\n${$AT}`,
  turnReminder:BAT
}
BAT="Be concise: lead with the result, skip preamble and narration, keep only what the user needs."
```

六规则（`$AT`）：Lead with the result · Cut narration · Short by default · State plainly · Give full detail on request · Never trade correctness for brevity（与更泛 communication 冲突时 **这些规则优先**）。

## #1 dig 备注（invent-ban）— **HAVE 已落地**

- **SEA 237-only 合同**：`eDT` `canMarkApiSystem` 从「非 latched + 非 DISABLE_EXPERIMENTAL_BETAS」改为 **provider/base-URL 资格门**（`FF&&rXt&&H2m || bedrock|vertex|mantle rzi || foundry JOT`）。自定义 `ANTHROPIC_BASE_URL` / gateway **不再**给 **api_system** 盖 `cache_control`（防 proxy 拒）；message-tail ephemeral 仍可跑。snippet：`gold-canMarkApiSystem-eDT.txt`。
- **tip**：`shouldCacheControlOnApiSystem(provider?, env?)` 已接资格门 + demote + experimentalBetas；`isApiSystemCacheControlEligible` 导出供单测。
- **不要** invent「关掉全部 ephemeral」当合同；**不要** invent Proactive。

## 非 changelog 旁注

| 项 | 说明 |
| -- | -- |
| Proactive style | SEA 236+ 已有；tip 无。**非** 237 官方 bullet → 不进 GAP 计数；Concise 落地时勿顺手 invent |
| npm 2.1.238 | 已存在于 registry · **本 pack 不折入** |
| 236 residual | Fo/Wlt · Ola/Dla · hold-policy · gold-weak UI · #33 N/A — 仍属 236 invent-ban，不并入 237 |

## Invent-ban

- 产品落地仅限用户 explicit（已落地：#1 canMarkApiSystem、#2 Concise、#3 r7）
- 不 invent Proactive / VSCode host / storageV5 / 「关掉全部 ephemeral」假合同
- 不自动 commit / bump / push
- 不折入 **2.1.238**

## 工件

- changelog：`changelog-2.1.237.md`
- snippets：`docs/upstream-extraction/v2.1.237/snippets/`
- board：`boards/alignment-237.md`
- progress：`artifacts/alignment-237-progress.md` / `.html`
