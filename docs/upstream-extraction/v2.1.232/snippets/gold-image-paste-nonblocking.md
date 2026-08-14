# densable 2.1.232 #38 — 粘贴/剪贴板图非阻塞读

## Changelog

> 粘贴/剪贴板图非阻塞读

## densable gold (SEA 2.1.232)

### Product intent

Clipboard image paste must **not** block the input loop / Enter path:

1. Empty paste (or image-path paste) triggers clipboard image check **async**
2. Pending paste has a hard safety ceiling so hung clipboard cannot swallow Enter forever
3. macOS fast path: native `hasClipboardImage` / `readClipboardImage` (~5ms) vs osascript (~1.5s)
4. GrowthBook gate for native path: `tengu_collage_kaleidoscope` (default true)
5. Analytics / hint keys: `chat:imagePaste`, `Image in clipboard`

### densable strings (SEA)

```text
hasClipboardImage
readClipboardImage   (native image-processor-napi)
Image in clipboard
chat:imagePaste
tengu_collage_kaleidoscope
```

## Local

- `src/hooks/usePasteHandler.ts`
  - `void getImageFromClipboard()` fire-and-forget (`.then` / `.catch` / `.finally(finishPaste)`)
  - `PASTE_PENDING_SAFETY_MS = 30_000` hard upper bound on paste-pending
  - debounce `CLIPBOARD_CHECK_DEBOUNCE_MS = 50`
- `src/utils/imagePaste.ts` `getImageFromClipboard`
  - `NATIVE_CLIPBOARD_IMAGE` + darwin + `tengu_collage_kaleidoscope` → `readClipboardImage`
  - fallback osascript / platform paths
- `useClipboardImageHint.ts` — async has-image on focus (hint only; not paste path)
- Tests: `imagePasteNonBlocking.232.test.ts` (+ existing usePasteHandler tests)

## Residual (not required for HAVE)

- densable symbol names for paste state machine (`UZr`/`d7r`) may differ; product behavior (async + safety ceiling + native fast path) is 1:1
