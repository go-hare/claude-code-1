# densable 2.1.237 — Changelog

> 来源：GitHub release **v2.1.237**（2026-08-20，@ashwin-ant）  
> Tag/commit：[`v2.1.237`](https://github.com/anthropics/claude-code/releases/tag/v2.1.237) / `770933ea1ad2fa7b858191e397a65e6644771c64`  
> SEA：`/tmp/official-237/plat/package/claude` · `2.1.237 (Claude Code)` · size **317110288** · sha256 `338901351d4ff17495738c67fc3e12a32c1b506738ac5e012eb782d3d8b5be43`  
> vs 236：size Δ **+65664** B（236 = 317044624 / `6bc4ba992d…`）  
> 口径：Changelog + checklist **盘点 only** · **不落地代码** · invent-ban · no auto commit/push/bump  
> 更新：2026-08-20

## What's changed（官方原文）

1. **Fixed prompt caching for sessions using an LLM gateway or custom base URL**
2. **Added a built-in "Concise" output style**: Claude leads with results and skips preamble and narration, while doing the work just as thoroughly. Select it under Output style in `/config`.

## SEA 指纹

| 项 | 值 |
| -- | -- |
| path | `/tmp/official-237/plat/package/claude` |
| `--version` | `2.1.237 (Claude Code)` |
| size | 317110288 |
| sha256 | `338901351d4ff17495738c67fc3e12a32c1b506738ac5e012eb782d3d8b5be43` |
| npm plat | `@anthropic-ai/claude-code-darwin-arm64@2.1.237` |

## 盘点摘要（初盘）

| # | key | 状态 | 一句话 |
| - | --- | ---- | ------ |
| 1 | gateway-custom-baseurl-prompt-caching | **PARTIAL** | tip 已有 midConv/`api_system` cache demote + `getPromptCachingEnabled`；236↔237 SEA 字面量几乎无差，修复面未锁死 |
| 2 | concise-output-style | **GAP** | SEA 237-only Concise built-in + `$AT` 六规则 + `turnReminder:BAT`；tip `OUTPUT_STYLE_CONFIG` 仅 default/Explanatory/Learning |

### SEA 旁注（非本 release 正文项）

- **Proactive** output style：SEA **236 已有**、237 仍有；tip `OUTPUT_STYLE_CONFIG` **无**。不计入 237 changelog GAP（官方未点名），落地 Concise 时勿 invent Proactive，除非用户扩 scope。

## 工件

- checklist：`official-237-checklist.md`
- progress：`artifacts/alignment-237-progress.md`
- snippets：`snippets/gold-concise-*.txt` · `snippets/hit-*.txt`
- board：`boards/alignment-237.md`
