# densable 2.1.212 — #30 @-mention partial read empty attachment (Eio)

Changelog (partial):

> Fixed … empty attachments after @-mention of partially-read files …

## densable `Eio` (generateFileAttachment)

```js
let l = t.readFileState.get(e)
if (l && o === "at-mention") {
  let c = HOe(l) && (l.content !== "" || (l.contentLength ?? 0) === 0)
  try {
    if (c && await GJe(e) === l.timestamp) {
      // already_read_file from cache content
      return { type: "already_read_file", ... content: { type:"text", file:{...} } }
    }
  } catch {}
}
// FileReadTool.call
if (p.data.type === "file_unchanged") return { type: "already_read_file", content: p.data }
if (p.data.type === "text" && p.data.file.truncatedByTokenCap === true) return await u() // truncated path
```

## densable `HOe` (isFullEnoughFileRead)

```js
function HOe(e){
  if ((e.offset??1)>1 || e.isPartialView) return false
  if (e.limit === void 0) return true
  return e.content !== "" && Tu(e.content,"\n")+1 < e.limit
}
```

## densable token-cap auto-page (FileRead text path)

Whole-file read (`(offset??1)<=1 && limit===undefined && pages===undefined`) that exceeds token cap:

- shrink line window (×0.85 then 6× ×0.7) else char-slice
- set `isPartialView` + `limit=pageLines` on cache
- `truncatedByTokenCap:true` on output
- `YAu(data, banner)` WeakMap; toolExecution `XAu` → `read_truncation_notice` attachment
- banner prefix `P3e = "[Truncated: PARTIAL view — "`

## Local alignment

| densable | local | status |
|----------|-------|--------|
| HOe gate on already_read | `isFullEnoughFileRead` in `generateFileAttachment` | **HAVE** |
| mtime `GJe === timestamp` | `getFileModificationTimeAsync === timestamp` | **HAVE** |
| `file_unchanged` → already_read | Eio post-call branch | **HAVE** |
| `truncatedByTokenCap` → truncated re-read | Eio post-call branch | **HAVE** |
| token-cap auto-page + YAu/XAu | FileReadTool + toolExecution | **HAVE** |
| normalize `read_truncation_notice` | messages.ts j5e escape | **HAVE** |

## Related

- `src/utils/attachments.ts` — `generateFileAttachment`
- `src/utils/fileStateCache.ts` — `isFullEnoughFileRead`
- `packages/builtin-tools/src/tools/FileReadTool/FileReadTool.ts`
- `src/services/tools/toolExecution.ts`
- `src/utils/__tests__/generateFileAttachment.eio.212.test.ts`
