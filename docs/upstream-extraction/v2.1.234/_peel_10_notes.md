# densable 2.1.234 #10 — Markdown unusual Unicode 极慢

## Changelog

> Fixed markdown rendering extremely slow for some unusual Unicode sequences

## SEA gold (CXr @ ~306370122)

| 符号 | 作用 |
|------|------|
| `uq` | invisible/control code-point predicate（href 清洗） |
| `d0l` | `Array.from(href).filter(cp≠10697 && !uq)` |
| `u0l` / `TPE` / `kPE` | ignorable class（含 `\p{M}` / `Default_Ignorable`）用于 OSC8 `l0l`/`kXr` 尾部 trim |
| `PPE` | 匹配 backtick span 内未转义 `\|` → `\\|` |
| `DPE` / `MPE` | PPE 后 body 行是否越 header 列宽 |
| `j6m` | `LE.use(j6m)`：`del` + `def(){}` + `table` 包装 `N6m`+PPE+DPE |
| `z6m` | promptMode lean lexer（基 j6m，再关 table/link…） |
| `_8m` | MD_SYNTAX 快路径 + LRU；**仍走 marked**（非 Bun.markdown） |

## 非产品差分（invent-ban / 误判）

- SEA **app JS 无** `Bun.markdown` / `.markdown.ansi` 调用；`bun-md-` / stack 错误串在 **Bun runtime** 嵌入区。
- 第二份 marked（~31877xxxx）含 `emStrongMask` hook；**CXr/`LE` 用的是第一份**（`anyPunctuation`/`blockSkip` mask，无自定义 `hooks.emStrongMask`）。
- 不把 marked `\p{P}\p{S}` 改成 ASCII punct（金标仍是 unicode punct）。

## 本地落地（go-hare）

- `src/utils/markdown.ts`：`escapePipesInInlineCode`(PPE)、`markdownTableHasExtraColumns`(DPE)、`stripMarkdownHrefInvisibles`(d0l)、`isMarkdownInvisibleCodePoint`(uq)；`configureMarked` ≈ densable `ifr`→`LE.use(j6m)`；link `formatToken` 用 d0l href。
- `src/components/Markdown.tsx`：`promptModeMarked` 补 `def()`（对齐 z6m 基 j6m）。
- 测试：`src/utils/__tests__/markdownUnicode.234.test.ts`

## 判定

**HAVE** — binary-backed j6m/PPE/DPE/d0l/uq 1:1；不 invent Bun.markdown。
