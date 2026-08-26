# densable 2.1.212 — #32 OTLP logs missing trace_id/span_id with TRACEPARENT

Changelog:

> Fixed OTLP event log records missing `trace_id`/`span_id` when `TRACEPARENT` is set in SDK/headless mode

## densable symbols

| densable | role |
|----------|------|
| `PKh` | parent context for log emit: active valid span, else `dn()&&TRACEPARENT` extract |
| `gu` | event emit: `{..., context: a}` when PKh returns |
| `DKh` | `W3CTraceContextPropagator` |
| `dn()` | `!isInteractive` (non-interactive / headless / SDK) |
| startInteraction | `dn()&&TRACEPARENT ? extract : active` as span parent |

### PKh

```js
function PKh() {
  let e = context.active()
  let t = trace.getSpan(e)?.spanContext()
  if (t && trace.isSpanContextValid(t)) return e
  if (dn() && Z.TRACEPARENT)
    return DKh.extract(e, { traceparent: Z.TRACEPARENT, tracestate: Z.TRACESTATE }, defaultTextMapGetter)
  return
}
```

### gu (event log)

```js
let a = PKh()
let l = {
  timestamp: s,
  observedTimestamp: s,
  body: `claude_code.${e}`,
  attributes: n,
  ...a && { context: a },
}
c.emit(l)
```

## Local alignment

| densable | local | status |
|----------|-------|--------|
| PKh | `getOTelEventParentContext` in `events.ts` | **HAVE** |
| gu context | `logOTelEvent` emit with `context` | **HAVE** |
| interaction extract | `startInteractionSpan` in `sessionTracing.ts` | **HAVE** |
| dn | `getIsNonInteractiveSession()` | **HAVE** |

## Related files

- `src/utils/telemetry/events.ts`
- `src/utils/telemetry/sessionTracing.ts`
- `src/utils/telemetry/__tests__/otelEventTraceparent.212.test.ts`
