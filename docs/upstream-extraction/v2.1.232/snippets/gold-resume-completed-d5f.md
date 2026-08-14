# densable 2.1.232 #44 — resume completed bg agent short message

## Changelog

> Shortened the message shown when resuming a completed background agent

## densable gold (SEA)

```js
// D5f — SendMessage resume success surface
function D5f(e, t) {
  let r = t !== void 0,
    n = dle(e) ? hi(e, 7) : e
  return r
    ? `Resumed agent ${n}. Result:\n${t || '(no text output)'}`
    : `Resuming agent ${n}`
}

// dle / jjg — agent-id shape (same as toAgentId)
// VIc = "[\\w-]{1,63}"
// jjg = /^a(?:${VIc}-)?[0-9a-f]{16}$/
function dle(e) {
  return jjg.test(e) ? e : null
}

// hi — UTF-16 code-unit truncate (drop lone high surrogate)
function hi(e, t) {
  if (t <= 0) return ''
  if (e.length <= t) return e
  let r = e.slice(0, t),
    n = r.charCodeAt(t - 1)
  return LFc(n >= 55296 && n <= 56319 ? r.slice(0, -1) : r)
}

// Y8a = X8a(e, "reply") → awaitCompletion; finalText = md(result.content, "\n")
// call sites (SendMessage agent-stopped / agent-evicted):
//   message: D5f(f.agentName, S.finalText)
//   resumedAgentId only when finalText undefined (and unowned / main-owned)
```

## Local

| densable | local |
| -------- | ----- |
| `D5f` | `formatResumedAgentMessage` in `resumeAgent.ts` |
| `dle` | `toAgentId` |
| `hi(e,7)` | `truncateCodeUnitsSafe(e, 7)` |
| `md(content, "\n")` | `extractTextContent(content, "\n")` |
| `Y8a` reply await | `resumeAgentBackground({ awaitCompletion: true })` → `finalText` |
| SendMessage wire | `tryDeliverToLocalAgent` agent-stopped / cold resume |

- Tests: `formatResumedAgentMessage.232.test.ts`
