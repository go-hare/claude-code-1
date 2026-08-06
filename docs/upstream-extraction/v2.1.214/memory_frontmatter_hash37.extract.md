# densable 2.1.214 — #37 memory frontmatter values truncated at inline `#`

> Binary: `C:/Users/Administrator/AppData/Local/Temp/official-214/package/claude.exe`  
> Official checklist: `docs/upstream-extraction/v2.1.214/official-214-checklist.md` item **#37**  
> Related: item **#10** (ISO `modified` stamp) shares the same write pipeline.

## 1. Official intent

Memory markdown frontmatter may contain unquoted values with an **inline `#`** (YAML comment start). A naive `YAML.parse` succeeds but **drops the comment tail**, so:

```yaml
description: path #1 item
```

becomes `description: "path"` — silent data loss. densable 2.1.214 fixes this on the **memory rewrite / stamp** path by detecting lossy scalars, re-quoting them before parse, and refusing destructive rewrites when the `#` cannot be proven-safe.

## 2. densable symbol map (minified)

| Minified | Role |
|----------|------|
| `J5` | `Bun.YAML.parse` |
| `SYt` | `Bun.YAML.stringify(e, null, 2) + "\n"` — memory serialize |
| `UYh` | Retry quoter for **parse failures** (≈ local `quoteProblematicValues`, plus flow-array skip) |
| `FYh` | `/[{}[\]*&#!\|>%@`]|: /` special-char set (includes `#`) |
| `BYh` | **Lossy-scalar detector + re-quoter** for `quoteLossyValues` |
| `xji` | Collect **unprovable** keys that still show inline `#` after stripping quoted spans |
| `km` | `parseFrontmatter` (+ options `{ quoteLossyValues, ... }`) |
| `kji` | Mapping guard: non-object → `{}` |
| `d2c` | rewriteHazard: empty mapping from non-empty block |
| `kX` | `/^---\s*\n([\s\S]*?)---\s*\n?/` (same as local `FRONTMATTER_REGEX`) |
| `q0t` | Stricter closed frontmatter: `/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/` |
| `bMe` | Memory parse: `km` → `cXh` normalize → `{ frontmatter, body, rewriteHazard? }` |
| `cXh` | Memory meta shape: `{ name, description, metadata }` (flatten unknown top-level keys into metadata) |
| `CBc` | Memory serialize: `---\n` + `SYt(n)` + `---\n\n` + body |
| `wBc` | Merge metadata fields (`originSessionId`, `modified`, …) |
| `O9n` | Read `metadata[key]` as non-empty string |
| `Zto` | **`stampNewMemoryContent(path, content)`** — FileWrite/FileEdit post-process |
| `hRg` / `gRg` / `yRg` | Surgical `modified:` line insert/update without full rewrite when stamp full-rewrite is unsafe |

Raw dumps:

- `docs/upstream-extraction/v2.1.214/frontmatter_SYt_UYh_BYh_km.raw.js`
- `docs/upstream-extraction/v2.1.214/frontmatter_BYh_km_kji.raw.js`
- `docs/upstream-extraction/v2.1.214/frontmatter_bMe_CBc.raw.js`
- `docs/upstream-extraction/v2.1.214/memory_stamp_serialize.raw.js`

## 3. densable semantics (1:1)

### 3.1 `BYh(frontmatterText)` — lossy re-quote

For each line:

1. Strip trailing `\r` for matching; preserve `\r` on rewrite.
2. Match simple key line: `/^([A-Za-z0-9_][A-Za-z0-9_.-]*):[ \t]+(.*)$/`.
3. If no match → `xji(line, unprovableKeys)` and keep line.
4. `value = rhs.trimEnd()`; skip empty; if value starts with `["'|>]` → `xji` + keep (already quoted / block).
5. `d = J5(value)` (parse **value alone** as YAML).
6. If parse result is not `string` and not `null` → `xji` + keep (non-scalar).
7. **Lossy if**:
   - `typeof d === "string" && d !== value` (YAML stripped a suffix — classic `bar # baz` → `bar`), **or**
   - `d === null` and value is not a null token (`null`/`Null`/`NULL`/`~`).
8. On lossy: push key to `quotedKeys`, replace line with `key: "<escaped value>"` (escape `\` and `"`).
9. Return `{ text: joined or null if no quotes, quotedKeys, unprovableKeys }`.

### 3.2 `xji(line, unprovableKeys)` — unprovable inline `#`

Match key (quoted or unquoted) + value; strip quoted spans from value; if remaining matches `/^#|[ \t]#/` push **key** into `unprovableKeys`.

These keys mean: there is an inline `#` that **cannot** be proven preserved by a full rewrite from the plain parse.

### 3.3 `km(markdown, sourcePath?, opts?)` — parseFrontmatter++

```
match kX → frontmatterText, content
if opts.quoteLossyValues:
  if q0t match disagrees with kX text → rewriteHazard =
    'the closing --- is ambiguous (a value containing "---"?) — part of the block may have read as body'
  f = BYh(frontmatterText)
  if f.unprovableKeys.length:
    u = `an inline '#' in [${keys}] cannot be preserved by a rewrite`
  if f.text !== null:
    try parse J5(f.text) → return early { frontmatter, content, rewriteHazard? }
    catch: warn `quoteLossyValues: quoting [keys] broke the document; a rewrite from the plain parse would drop their inline '#' content`
plain try J5(frontmatterText)
catch: retry UYh(quote specials) + tab→spaces; else parseError + warn
if quoteLossyValues: rewriteHazard = c | parse fail msg | u | d | d2c(...)
return { frontmatter, content, parseError?, rewriteHazard? }
```

**Important:** Without `quoteLossyValues`, densable still uses plain `J5` and **still truncates** on read (skills/agents/etc.). The #37 fix is gated on the memory rewrite path.

### 3.4 Memory normalize / serialize

- `bMe(content, path?, opts?)` → `{ frontmatter: cXh(raw), body, rewriteHazard? }`
- `cXh`: `name`/`description` string-or-null; remaining top-level keys (except reserved) folded into frozen `metadata` with nested `metadata:` object.
- `CBc(mem, body)` uses `Bun.YAML.stringify(..., null, 2)` so a successful full rewrite **heals** previously unquoted lossy values on disk (proper quoting for `#`).

### 3.5 `Zto` = `stampNewMemoryContent(filePath, content)`

Call sites (binary): FileEdit updated content + FileWrite content (offsets ~235598819, ~235605547).

```
if !(path.endsWith(".md") && isMemoryPath(path)) || !kX.test(content): return content
iso = new Date().toISOString()
// full provenance stamp only if not team-memory path and originSessionId absent
parsed = bMe(content, path, { quoteLossyValues: true })
if parsed && no originSessionId:
  if !rewriteHazard:
    return CBc(wBc(frontmatter, { originSessionId: sessionId(), modified: iso }), body)
  else warn: stampNewMemoryContent: not stamping provenance on ${path} — ${hazard}
// fallback: surgical modified-only update
s = hRg(content, iso)
if s === null: warn not dating … no faithful place; return original
return s
```

`hRg` preserves body and other frontmatter lines; updates/inserts `modified:`; keeps trailing ` # comment` on existing `modified` line via `gRg` when value is unquoted; verifies round-trip with `bMe` + deep-equal metadata including `modified`.

**#37 effect on write:**  
`quoteLossyValues: true` makes stamp parse recover full values including `#`. If recovery is unprovable / ambiguous / would drop `#`, densable **does not rewrite** (avoids baking truncation). If recovery is clean, `CBc` re-serializes with quoted YAML so future plain parses keep the full string.

## 4. Local status (GAP)

| Piece | Local | densable 214 |
|-------|-------|--------------|
| `parseFrontmatter` plain YAML | `src/utils/frontmatterParser.ts` + `parseYaml`/`Bun.YAML.parse` | `km`/`J5` |
| `quoteProblematicValues` on **parse throw** | Yes (`YAML_SPECIAL_CHARS` includes `#`) | `UYh` (+ flow `[...]` skip) |
| **`quoteLossyValues` / `BYh` / `xji`** | **Missing** | Present |
| `rewriteHazard` / `parseError` on parse result | **Missing** | Present |
| Memory meta `cXh` / `bMe` / `CBc` / `SYt` | **Missing** (scan uses flat `frontmatter.description`/`type`) | Present |
| `stampNewMemoryContent` on Write/Edit | **Missing** | `Zto` on write tools |
| ISO `modified` / `originSessionId` (#10) | **Missing** | Via `Zto` |

### Local repro (Bun, 2026-08-06)

```text
description: bar # baz     → description "bar"      // truncated
description: "bar # baz"   → "bar # baz"            // OK quoted
description: bar#baz       → "bar#baz"              // OK no space before #
description: path #1 item  → "path"                 // truncated
```

Root cause: YAML comment rules + **successful** parse means local `quoteProblematicValues` **never runs** (only on throw). densable `BYh` compares scalar parse ≠ raw value and re-quotes proactively under `quoteLossyValues`.

Consumers of truncated data today:

- `src/memdir/memoryScan.ts` — `parseFrontmatter` → `description` / `type` for manifest
- extractMemories prompts / recall (via scan)
- Any memory file rewritten by tools without densable stamp will permanently lose `#` tails if something round-trips unquoted YAML

## 5. Exact edit plan (1:1, no simplified substitute)

### A. `src/utils/frontmatterParser.ts` (or sibling re-exported)

1. Extend `parseFrontmatter` options:

```ts
type ParseFrontmatterOptions = {
  quoteLossyValues?: boolean
}
// return type gains:
// parseError?: string
// rewriteHazard?: string
```

2. Port **verbatim**:
   - `detectAndQuoteLossyFrontmatterValues` ← `BYh`
   - `collectUnprovableHashKeys` ← `xji`
   - stricter `CLOSED_FRONTMATTER_REGEX` ← `q0t`
   - `rewriteHazard` assembly order as in `km`
3. Keep existing plain parse + `quoteProblematicValues` fallback as densable `UYh` path (optionally port flow-array skip for 1:1).
4. Do **not** enable `quoteLossyValues` globally for skills unless densable does (it does not for default `km`).

### B. Memory module (new or under `src/memdir/`)

1. `parseMemoryFile` ← `bMe` + `cXh` shape (`name`, `description`, `metadata` with `node_type: "memory"`).
2. `serializeMemoryFile` ← `CBc` + `Bun.YAML.stringify` / add `stringifyYaml` to `src/utils/yaml.ts`.
3. `mergeMemoryMetadata` ← `wBc`; `getMemoryMeta` ← `O9n`.
4. `stampNewMemoryContent(path, content)` ← `Zto` + `hRg`/`gRg`/`yRg` surgical branch.
5. Memory path gate: densable `sre(path)` + `.md` + existing auto-mem / memdir path helpers (`src/memdir/paths.ts`); team-mem skip ← densable `zle`.

### C. Wire write tools

- `packages/builtin-tools/src/tools/FileWriteTool/FileWriteTool.ts`
- `packages/builtin-tools/src/tools/FileEditTool/FileEditTool.ts`

After computing final file text for memory paths, `content = stampNewMemoryContent(path, content)` (densable order: Edit uses patch from stamped text; Write stamps before mkdir/write).

### D. Tests

1. Unit: `BYh` cases — space-hash truncates raw YAML; after lossy quote, full string recovered; `bar#baz` unchanged; unprovable keys when nested `#` cannot be proven.
2. `parseFrontmatter(..., { quoteLossyValues: true })` returns full description + optional `rewriteHazard`.
3. `stampNewMemoryContent`:  
   - clean unquoted `#` → full rewrite with quoted description + `modified` + `originSessionId`  
   - unprovable / ambiguous `---` → no destructive rewrite; content preserved  
   - non-memory path → identity
4. Regression: skills frontmatter without option still matches current behavior (optional).

### E. Checklist linkage

- Land **#37** with A+C (lossy parse + non-destructive stamp gate) minimum.
- Land **#10** with full `Zto`/`hRg` `modified` ISO (same PR natural).

## 6. Non-goals / do not invent

- Do not change global skill/agent frontmatter to always force-quote (densable does not).
- Do not “fix” truncation by stripping `#` semantics from YAML.
- Do not stamp team-memory / non-`.md` / non-memory paths.
- Do not full-rewrite when `rewriteHazard` is set.

## 7. Confidence

| Claim | Evidence |
|-------|----------|
| Lossy `#` is real under Bun.YAML | Local repro above |
| densable fix is `BYh` + `quoteLossyValues` + stamp refuse/rewrite | Binary functions at ~233050250–233053200, `Zto` ~234998170 |
| Write integration | `Zto(` call sites in edit/write pipelines |
| Local GAP | No `quoteLossy`/`rewriteHazard`/`stampNewMemoryContent` symbols in `src/` |

**Status recommendation:** keep checklist **#37 = GAP** until A–C land with tests.
