# densable 2.1.212 — #31 OTel HTTP non-chunked (Content-Length)

Changelog:

> Fixed OpenTelemetry HTTP exports being rejected with 411/400 by Azure Monitor and other endpoints that don't accept chunked transfer encoding

## densable symbols

| densable | role |
|----------|------|
| `Lvd` | coerce write/end chunk → `Buffer` |
| `YAo(agent)` | wrap `Agent.addRequest`: buffer body, `setHeader("Content-Length", …)` before real `end` |
| `Mvd(endpoint)` | `HttpAgentFactory` — proxy / `http:` / `https:` agents, each `YAo`-wrapped; `keepAlive:true`, `maxSockets:1` |
| `d1y(url)` | localhost → skip proxy |
| `JAo(signal)` | `getOTLPExporterConfig` — **always** `httpAgentOptions = Mvd(...)` |

### YAo core

```js
function YAo(e) {
  let t = e, r = t.addRequest.bind(t)
  return t.addRequest = function (o, ...i) {
    if (!o.getHeader("content-length") && !o.getHeader("transfer-encoding")) {
      // intercept write/end → Buffer.concat → setHeader Content-Length → original end
    }
    r(o, ...i)
  }, e
}
```

## Local alignment

| densable | local | status |
|----------|-------|--------|
| Lvd/YAo/Mvd/d1y | `src/utils/telemetry/otlpHttpAgent.ts` | **HAVE** |
| JAo always Mvd | `getOTLPExporterConfig` in `instrumentation.ts` | **HAVE** |

## Related files

- `src/utils/telemetry/otlpHttpAgent.ts`
- `src/utils/telemetry/instrumentation.ts`
- `src/utils/telemetry/__tests__/otlpHttpAgent.212.test.ts`
