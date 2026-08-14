# densable 2.1.232 #16 — MCP connect timeout / protocol probe budget

## Changelog

> MCP connect: protocol version probe failure / malformed response no longer blocks the full 30s

## densable gold (SEA 2.1.232)

### Timeouts

```js
function y0() {
  let e = X.MCP_TIMEOUT
  return e && e > 0 ? Math.min(e, 2147483647) : 30000
}
function Obf() {
  let e = X.MCP_CONNECT_TIMEOUT_MS
  return e && e > 0 ? Math.min(e, 2147483647) : 5000
}
// RiS=5000, CiS=5000, xiS=3000
function IiS() {
  let e = y0()
  return Math.max(e - RiS, Math.floor(e / 3))
}
```

### Protocol plan `k5a`

- Env `MCP_PROTOCOL_NEGOTIATION` ∈ {`legacy`,`auto`}; invalid → warn + ignore.
- `legacy` → `{mode:"legacy"}`.
- `auto` → only for auto-capable transports (http / stdio / claudeai-proxy); probe caps `min(CiS|xiS, floor(y0/3))`.
- Else per-transport GB default **false**:
  - `tengu_mcp_protocol_negotiation_http`
  - `tengu_mcp_protocol_negotiation_claudeai`
  - `tengu_mcp_protocol_negotiation_stdio`
- sse / ws / ide / in-process / sdk-control / ccr-proxy → always legacy.

### Connect race + pinned-legacy residual

```js
let P =
  f.mode === 'auto'
    ? C.connect(l, { timeout: IiS() })
    : C.connect(l, { timeout: y0() })
// outer race always y0:
setTimeout(..., y0())
// timeout error:
function oMf(e) {
  let t = new Rt(e, 'MCP connection timeout')
  if (rt('tengu_mcp_connect_timeout_retry', true))
    return Object.assign(t, { code: 'CONNECT_TIMEOUT' })
  return t
}
```

Auto probe catch (SEA):

```js
let le = f?.mode==="auto" && ee instanceof rd && ee.code===Mu.EraNegotiationFailed
let ge = f?.mode==="auto" && ee instanceof rd && ee.code===Mu.RequestTimeout && l?._anthropicProbeTimedOut===!0
// stdio hard-close → respawn closed
// else le|ge + recreate → probe_timeout / probe_failed
// then C=k({mode:"legacy"}); ye=Math.max(1000,y0()-(Date.now()-n)); connect(l,{timeout:ye})
// if ge && !auth && !outerTimedOut → rethrow original ee (preserve CONNECT_TIMEOUT ladder)
```

User-facing debug:

- `version negotiation probe closed the stdio server (rmcp-class pre-init hard close); respawning pinned legacy`
- `version negotiation probe timed out on the ${type} transport; reconnecting pinned legacy within the remaining budget`
- `version negotiation probe failed on the ${type} transport; reconnecting pinned legacy`
- `pinned-legacy retry after the probe timeout failed typed (…); preserving the timeout classification so the connect stays ladder-retryable`

Failed connect classification:

```js
if (h instanceof rd && h.code === Mu.RequestTimeout && rt('tengu_mcp_connect_timeout_retry', true))
  S = 'CONNECT_TIMEOUT'
```

## Local

| densable | local |
| -------- | ----- |
| `y0` | `getMcpTimeoutMs` |
| `Obf` | `getMcpConnectTimeoutMs` |
| `IiS` | `getMcpInitializeTimeoutMs` |
| `oMf` | `createMcpConnectionTimeoutError` |
| `k5a` (mode + probe budget) | `resolveMcpProtocolNegotiationPlan` |
| `client.connect(..., {timeout})` | wired in `client.ts` |
| outer race + CONNECT_TIMEOUT | wired |
| RequestTimeout → CONNECT_TIMEOUT | `extractMcpConnectionErrorCode` |
| auto probe classify + pinned-legacy retry budget | `classifyMcpAutoProbeFallback` / `getMcpPinnedLegacyRetryTimeoutMs` / preserve helpers |
| client reconnect path | `client.ts` recreate transport + new Client + remaining budget race |
| SDK `_anthropicProbeTimedOut` / EraNegotiationFailed emit | residual (public MCP SDK may not set marker; path ready) |

- Module: `src/services/mcp/mcpConnectTimeout.ts`
- Wire: `src/services/mcp/client.ts`
- Tests: `mcpConnectTimeout.232.test.ts`
