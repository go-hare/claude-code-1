# densable 2.1.212 — #36 mid-conversation system + prompt cache (gateway / custom baseURL)

Changelog:

> Improved prompt caching: the mid-conversation system block now works behind LLM gateways and custom base URLs (Bedrock, Vertex, 1P)

## densable pieces

### 1. Model gate `J8t` (memoized, ≈ local `shouldUseMidConversationSystem`)

```js
J8t = Pr(e => {
  if (Jee('hipaa')) return false
  if (Z.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM) return true
  let t = jae(e, 'mid_conversation_system')
  if (t !== undefined) return t
  let r = lo(e) // canonical name
  if (
    r.includes('claude-3-') ||
    r === 'claude-opus-4-0' ||
    /* …known unsupported… */ r === 'claude-haiku-4-5'
  )
    return false
  if (PW(r, 'mid_conv_system') || r === 'claude-mythos-5') return true
  return fj(P_(e)) // capability fallback
})
```

Beta header: `o3 = mid-conversation-system-2026-04-07` pushed when `J8t(model)` — **not** firstParty-gated.

### 2. Beta strip `xNi` for non-1P-ish providers

```js
function qBn() {
  let e = xn()
  return e === 'firstParty' || e === 'anthropicAws' || e === 'foundry'
}
function Vme() {
  return Z.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS || Jee('hipaa')
}
function xNi(e) {
  if (qBn()) return e
  return e.filter(t => LLc.has(t))
}
// LLc includes o3 among others
```

**Why gateways work:** `o3` is allowlisted through `xNi` even when `qBn()` is false.

### 3. Wire shape: `api_system` → `role:"system"` in messages

`B6n(text)` builds `{ type: "api_system", message: { role: "system", content: text } }`.

`eN` (normalize for API) flushes meta system text:

- if last is already `api_system` → append
- else if last is `user` → push new `B6n(D)` (**mid-conversation system block**)
- else → meta user message

### 4. Cache breakpoints `Jdy` (densable addCacheBreakpoints)

Prefer `cache_control` on trailing nonempty `api_system` when `!Vme() && !Gri()` (not firstParty-gated). Map `api_system` → `{ role:"system", content: [...] }`.

### 5. Proxy / server rejection sticky (`vi`)

```js
// KQn: server rejected role:"system"
// → q() midConvFallback renorm without model, DV(o3), sticky until /clear|/compact
// → "retry:mid-conv-system"
// e9i: proxy rejected cache_control on api_system tail (and Q had system cache)
// → DV(y1r internal latch), Vri() midConvCachePromotionRejected
// → "retry:api-system-cache-demote"
```

`Ydy` builds:

```js
a = eN(n, tools, midConvLatchedOff ? void 0 : model)
c = !midConvLatchedOff && betas.includes(o3)
  ? a.some(api_system)
    ? () => post(eN(n, tools, void 0))
    : () => a
  : null
// return { messagesForAPI: a, midConvFallback: c }
```

## Local status (2026-08-06) — HAVE

| densable | local | status |
|----------|-------|--------|
| `J8t` model gate | `shouldUseMidConversationSystem` | **HAVE** — hipaa, FORCE, sticky, known-unsupported, mythos, `providerSupportsMidConvCapability` |
| push `o3` without 1P gate | `getAllModelBetas` | **HAVE** |
| `xNi` 3P allowlist keep `o3` | `filterBetasForProvider` / `THIRD_PARTY_BETA_ALLOWLIST` | **HAVE** |
| `api_system` / `B6n` / `eN` inject | `createApiSystemMessage` + `normalizeMessagesForAPI(…, model)` | **HAVE** |
| `Jdy` cache on api_system | `addCacheBreakpoints` | **HAVE** |
| demote / latch / retry | sticky + `MidConvSystemRetryError` + midConvFallback | **HAVE** |
| `/clear` `/compact` reset | `clearBetaHeaderLatches` + clear caches | **HAVE** |

## Related local files

- `src/utils/midConversationSystem.ts`
- `src/utils/betas.ts` (`MID_CONVERSATION_SYSTEM_BETA_HEADER`, `xNi`)
- `src/bootstrap/state.ts` (`stickyBetas`, `midConvCachePromotionRejected`)
- `src/services/api/claude.ts` (`Ydy` normalize + `vi` retry + `Jdy`)
- `src/services/api/withRetry.ts` (`MidConvSystemRetryError`)
- `src/utils/messages.ts` (`normalizeMessagesForAPI`, `ensureToolResultPairing`, `stripAdvisorBlocks`)
- `src/commands/clear/caches.ts` / `postCompactCleanup.ts`
