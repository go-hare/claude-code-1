# densable 2.1.212 — #20 FileEdit/FileWrite not-read + HOe + Woo rehydrate

Source: densable SEA `claude.exe` 2.1.212.

## Changelog

> Fixed a spurious "File has not been read yet" error when editing a file that had been read with offset/limit before resuming a session

Root cause on incomplete ports: resume rehydrate dropped ranged Reads → cache miss → not-read gate.

## HOe / xOe / DAu

```js
function DAu(e){return Bun.hash(e).toString(36)}
function HOe(e){
  if((e.offset??1)>1||e.isPartialView)return!1
  if(e.limit===void 0)return!0
  return e.content!==""&&Tu(e.content,"\n")+1<e.limit
}
function xOe(e,t){
  if(e.contentHash!==void 0)return e.contentHash===DAu(t)
  return e.content===t
}
// Tu = count occurrences of needle in string
```

Local: `isFullEnoughFileRead` / `fileStateContentMatches` / `fileStateContentHash` in `src/utils/fileStateCache.ts`.

## FileEdit validate (errorCode 6 / 7)

```js
let p=t.readFileState.get(s)
if(!p||p.isPartialView){
  // analytics tengu_edit_tool_not_read_hypothetical
  // guard skip: !Hki(model)&&nZi(path,ctx) — local omits speculative apply skip
  if(!S)return{
    result:!1,behavior:"ask",
    message:"File has not been read yet. Read it first before writing to it.",
    errorCode:6
  }
}
if(p){
  if(b7(s)>p.timestamp)
    if(HOe(p)&&xOe(p,d)); // content-equal full-enough → ok
    else return { result:!1, behavior:"ask", message:"File has been modified since read...", errorCode:7 }
}
```

## FileWrite validate (errorCode 2 / 3)

```js
let c=r.readFileState.get(n)
if(!c||c.isPartialView){
  // tengu_velvet_mallet only when completely unread
  let f=!c&&Qe(xki("tengu_velvet_mallet",d),!1)
  if(!f)return{result:!1,message:"File has not been read yet...",errorCode:2}
  return{result:!0}
}
if(Math.floor(l)>c.timestamp){
  let d=HOe(c),p=!1
  if(d){ /* read disk utf8 CRLF-normalize */ p=xOe(c,m) }
  if(!p)return{result:!1,message:"File has been modified since read...",errorCode:3}
}
```

## Woo extractReadFilesFromMessages

1. First pass: Read tool_use → keep **offset/limit** (yZt coerce); Write; Edit; also `read_truncation_notice` attachment toolUseIDs.
2. Second pass tool_result:
   - Read: `offset:u.offset??1`, `limit:u.limit`, `isPartialView` when:
     - `toolUseResult.file.truncatedByTokenCap`
     - truncation notice attachment
     - content starts with `"<system-reminder>"+P3e` where `P3e="[Truncated: PARTIAL view — "`
   - Write: full content, offset/limit undefined
   - Edit: disk re-read

## Local alignment

| densable | local |
|----------|-------|
| HOe/xOe | `fileStateCache.ts` |
| Edit not-read / stale | `FileEditTool.validateInput` + call path |
| Write not-read / stale | `FileWriteTool.validateInput` + call path |
| Woo ranged rehydrate | `queryHelpers.extractReadFilesFromMessages` |
