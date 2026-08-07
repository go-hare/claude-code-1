# densable 2.1.216 — auto mode HTTP 401 mid-session (1:1)

> **id:** `auto-mode-401` · Changelog #3  
> **Status:** **HAVE** (sideQuery recover+retry + fO_/mO_/Mhd + hUd/f6d empty + CYu handoff landed 2026-08-06)  
> Deep dig: `DEEP-1TO1.md` · dumps: `auto-mode-401.*`, `runtime-401-*.txt`

---

## 1. Product intent (changelog)

> Fixed auto mode denying commands with "HTTP 401" classifier errors after the OAuth token expired or rotated mid-session.

---

## 2. densable binary proof

| Needle | Hit | Notes |
|--------|-----|-------|
| `HTTP 401` | true | mostly package-resolve / Design auth — **not** auto-mode deny template |
| `oauth_401` | true | recovery telemetry family |
| `Classifier unavailable` | true | DCt + fail-closed deny |
| `shouldBlock` | true | classifier result shape |
| `yolo` / `auto mode classifier` | true | local port in yoloClassifier.ts |
| `token expired` | true | auth strings near recovery |

**Important:** literal user-facing `"HTTP 401"` is **not** in densable auto-mode deny builders (f6d returns `""`). Changelog refers to error class / `errorKind: http_401`, not a fixed deny string.

---

## 3. Cleaned densable schema / strings

### Decision / user strings

- `Classifier unavailable` (decisionReason.reason constant DCt)
- `Classifier unavailable - blocking for safety`
- Stage 2: `… blocking based on stage 1 assessment (usually transient — retrying often succeeds)`
- `Classifier request aborted`
- `Classifier transcript exceeded context window`
- Log: `Auto mode classifier unavailable, denying with retry guidance (fail closed)`
- hUd: `${model} is temporarily unavailable${detail}, so auto mode cannot determine the safety of "${toolName}" right now. Wait briefly…`
- f6d(httpStatus,errorKind): extension point; **empty body in 2.1.216**
- Handoff CYu: allow-with-warning (not deny)

### Classifier error path extras

```ts
{
  shouldBlock: true,
  reason: string,
  model: string,
  unavailable?: boolean,
  httpStatus?: number,   // APIError.status (401 included)
  errorKind?: string,    // http_401 | http_401_no_retry | connection_error | …
  transcriptTooLong?: boolean,
  stage?: 'fast' | 'thinking',
}
```

Telemetry: `tengu_auto_mode_decision` decision ∈ `{unavailable, blocked, allowed}`;  
`tengu_oauth_401_sidequery_recovered` `{ querySource, httpStatus }`.

---

## 4. Cleaned densable runtime

```js
// Control-flow for changelog fix:
// OAuth expire/rotate mid-session
//   → classifier sideQuery hits API 401
//   → shouldRetry allows 401 + invalidate caches
//   → sideQuery catch: recoverOAuthAfter401 then single rebuild+retry
//   → success: tengu_oauth_401_sidequery_recovered; classifier continues
//   → failure: errorKind http_401, unavailable+shouldBlock, fail-closed deny
// Intentionally: do NOT demote classifier model on http_401 (Mhd false)

async function sideQuery(opts) {
  try {
    return await doRequest(request);
  } catch (se) {
    if (!(se instanceof APIError) || !(se.status === 401 || isTokenRevoked(se))
        || !accessTokenSnapshot || signal?.aborted) throw se;
    const recovered = await recoverOAuthAfter401(accessTokenSnapshot); // _B/fog
    if (!recovered) throw se;
    const retried = await doRequest(await rebuildRequestWithFreshAuth());
    telemetry('tengu_oauth_401_sidequery_recovered', {
      querySource: normalizeQuerySource(opts.querySource), // includes "auto_mode"
      httpStatus: se.status,
    });
    clearRemoteAuthFailTimer();
    return retried;
  }
}

// fog/_B order: SDK getOAuthToken → disk claudeAiOauth rotation
//   → poll CLAUDE_CODE_OAUTH_401_WAIT_MS → no-refresh telemetry + optional zombie exit
//   → keychain rotated access → forced refresh Gy(0,true,failedAccessToken)

function classifyClassifierErrorKind(e) { // fO_
  // abort → wall_clock_timeout; connection timeouts/errors;
  // APIError + x-should-retry false → http_${status}_no_retry
  // APIError → http_${status}  // http_401
}

function isTransientClassifierErrorKind(kind) { // mO_
  // timeouts + http 429 + 5xx only — NOT 401
}

function allowModelDemotionOrProbe(kind) { // Mhd
  return kind !== undefined && !/^http_401/.test(kind);
}

// permissions: result.unavailable → deny fail-closed with DCt + hUd
// handoff: unavailable → allow with CYu warning
```

### Mangled symbols

`fog`/`_B`, `vqc`, `pog`, `WYt`/`T9r`, `Gy`/`YKn`, `JYt`, `lly`, `FRe`, `sideQuery`, `oO_`, `nPt`, `fO_`, `mO_`, `Mhd`, `DCt`, `hUd`/`f6d`/`eay`/`CYu`

---

## 5. go-hare land status (was gap; now HAVE)

| Path | Status |
|------|--------|
| `src/utils/sideQuery.ts` | **HAVE** (was PRIMARY GAP) — no OAuth 401 recover+single-retry; no sidequery recovered event |
| `src/utils/auth.ts` handleOAuth401Error | **HAVE** oauth_401 telemetry aligned |
| `src/services/api/withRetry.ts` | **AUDIT** — classifier uses sideQuery maxRetries, not withRetry alone |
| `src/types/permissions.ts` YoloClassifierResult | **HAVE** httpStatus/errorKind |
| `src/utils/permissions/yoloClassifier.ts` | **HAVE** fO_/mO_/Mhd + stage2 |
| `src/utils/permissions/permissions.ts` | **HAVE** fail-closed + httpStatus/errorKind |
| `src/utils/messages.ts` buildClassifierUnavailableMessage | **HAVE** hUd signature + empty f6d |
| AgentTool handoff | **HAVE** allow-with-warning + CYu |

---

## 6. 1:1 implement steps (ordered)

1. Port sideQuery 401/revoked branch 1:1 (snapshot access token; recover; rebuild; retry once; telemetry; abort safety).
2. Align fog/_B order + oauth_401_* events (disk_read_failed, no_refresh_bg/interactive, breadcrumb).
3. Port/audit shouldRetry 401 branches used by transport.
4. Attach httpStatus/errorKind in XML + tool_use catch paths; exact reasons.
5. Port nPt: only mO_ transient kinds get model fallback; Mhd excludes `/^http_401/`.
6. Permissions fail-closed for unavailable with DCt + hUd; not active-block path.
7. Keep handoff allow-with-warning (CYu) distinct.
8. Wire telemetry strings/events exact.
9. Regression tests (section 7).
10. `bun run precheck`; do **not** invent non-empty f6d HTTP 401 user text.

---

## 7. Tests

- Mid-session expired OAuth: sideQuery 401 → recover → retry → classifier continues; event with querySource `auto_mode`.
- Unrecoverable 401: errorKind `http_401`, unavailable deny, no model demotion.
- 429/500 still transient-eligible.
- Aborted ≠ 401 path.
- Permissions fail-closed message shape.
- fO_/mO_/Mhd unit cases.
- Handoff unavailable allows with warning.

Suggested:

- `src/utils/__tests__/sideQuery.oauth401.216.test.ts`
- `src/utils/permissions/__tests__/yoloClassifier.http401.216.test.ts`
- `src/utils/permissions/__tests__/autoMode401FailClosed.216.test.ts`
- `src/utils/permissions/__tests__/classifierErrorKind.216.test.ts`
- AgentTool handoff unavailable test
- auth oauth401 telemetry test

---

## 8. Risks / do-not-simplify

- Do **not** invent user-facing `"HTTP 401"` deny text without densable evidence.
- Package-manager HTTP 401 strings are false positives.
- Bridge OAuth refresh ≠ classifier sideQuery path.
- Mhd excluding http_401: pure-auth failure will not fall back models — only OAuth recovery heals.
- Double-refresh races: densable single-flight _B + locks.
- Handoff unavailable allow vs main deny — mixing is security/product divergence.
- UNCERTAIN: tool_use catch full parity; FRe body; Gy failedAccessToken arg exact signature.
