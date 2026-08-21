# densable 2.1.237 · Alignment Progress

**2026-08-21** · SEA `2.1.237` · tip baseline `2.1.236 land / npm 2.7.45`

| HAVE | PARTIAL | GAP | N/A | UNKNOWN |
| ---- | ------- | --- | --- | ------- |
| **3** | **0** | **0** | **0** | **0** |

## Checklist

| # | key | 状态 | 证据摘要 |
| - | --- | ---- | -------- |
| 1 | gateway-custom-baseurl-prompt-caching | **HAVE** | SEA `eDT`/`canMarkApiSystem` → tip `isApiSystemCacheControlEligible` + `shouldCacheControlOnApiSystem`；custom BASE_URL/gateway 不盖 api_system `cache_control`；tests 29 pass |
| 2 | concise-output-style | **HAVE** | SEA Concise + `$AT` + `turnReminder:BAT`；attachment/messages/withRetry 已接线；不 invent Proactive |
| 3 | isOutputLineTruncated-r7 | **HAVE** | SEA `r7`/`t7` typeof + wrap-aware；修 MessagesBoundary ← MCPTool object → `indexOf` crash |

## SEA fingerprint

- `/tmp/official-237/plat/package/claude`
- size `317110288` · sha256 `338901351d4ff17495738c67fc3e12a32c1b506738ac5e012eb782d3d8b5be43`
- vs 236 Δ `+65664` B

## Official bullets

- Fixed prompt caching for sessions using an LLM gateway or custom base URL
- Added built-in **Concise** output style (lead with results, skip preamble/narration)

## Next

- 等用户：提交 / bump / 扩 238
- 旁注：Proactive 故意不 invent（非 237 bullet）
- no auto commit / push / bump
