# densable 2.1.212 — #33 multi-image “Request too large”

Changelog:

> Fixed multi-image conversations incorrectly reporting “Request too large”
> and improved the error message

## densable constants

| symbol | value | role |
|--------|-------|------|
| `R5i` | `33554432` (32 MiB) | API total request body hard limit |
| `UWr` | `20971520` (20 MiB) | PDF target raw (local `PDF_TARGET_RAW_SIZE`) |
| `Ba` | formatFileSize | human size string |

## densable `X8i` (user-facing copy)

```js
function X8i() {
  let e = `max ${Ba(R5i)}`
  return dn()
    ? `Request too large (${e}). Accumulated images and attachments in the conversation pushed the request over the limit. Remove older images or compact the conversation.`
    : `Request too large (${e}). Accumulated images and attachments in the conversation pushed the request over the limit. Run /compact, or double press esc to go back and remove attachments.`
}
```

Previous local copy used `PDF_TARGET_RAW_SIZE` (20MB) and single-file wording —
mis-attributed multi-image body overflow to “a smaller file”.

## densable 413 handler

```js
if (e instanceof ni && e.status === 413) {
  if (e.message.toLowerCase().includes('context window'))
    return su({ content: W3 /* Prompt is too long */, error: 'invalid_request', errorDetails: e.message })
  return su({
    content: X8i(),
    error: 'invalid_request',
    errorDetails: `request_too_large: ${e.message}`,
  })
}
```

## densable `Gvg` / `euu` (media strip eligibility)

```js
function Gvg(e) {
  return e.includes('request_too_large') || V8i(e) !== void 0
}
function euu(e) {
  if (e.includes('request_too_large') || e.toLowerCase().includes('too much media'))
    return new Set(['document', 'image'])
  // …
}
```

Local `isMediaSizeError` gains `request_too_large` so reactive compact /
media-strip can treat 413 body overflow like other media rejections.

## Local alignment

| densable | local |
|----------|-------|
| `R5i` | `API_REQUEST_BODY_MAX_SIZE` in `apiLimits.ts` |
| `X8i` | `getRequestTooLargeErrorMessage()` |
| 413 split | `getAssistantMessageFromError` |
| `Gvg` | `isMediaSizeError` + `request_too_large` |

## Not changed

- Single-image 5MB / many-image 2000px branches (already present)
- PDF page / password / invalid handlers
