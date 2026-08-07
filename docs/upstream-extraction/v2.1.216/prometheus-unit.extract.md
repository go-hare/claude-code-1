# densable 2.1.216 #26 — Prometheus invalid `# UNIT` lines

## Official

> Fixed the Prometheus metrics endpoint (`OTEL_METRICS_EXPORTER=prometheus`) emitting invalid `# UNIT` lines

## densable gold

Embedded OTEL PrometheusSerializer `_serializeMetricData`:

```js
let o = `# HELP ${r} ${Dko(e.descriptor.description || 'description missing')}`
let i = e.descriptor.unit
  ? `\n# UNIT ${r} ${Dko(e.descriptor.unit)}`
  : ''
let s = `# TYPE ${r} ${yY_(e)}`
// …
return `${o}${i}\n${s}\n${l}`.trim()
```

**Gate:** only emit `# UNIT` when `descriptor.unit` is truthy. Empty string / missing unit → no UNIT line (OpenMetrics rejects empty unit tokens).

## Local land

| Surface | Status |
|---------|--------|
| `@opentelemetry/exporter-prometheus@0.215.0` | **Already embeds** the same `metricData.descriptor.unit ? … : ''` gate in `PrometheusSerializer.js` |
| `src/utils/telemetry/instrumentation.ts` | `new PrometheusExporter()` — no custom serializer |
| `src/utils/telemetry/prometheusUnitLine.ts` | pure densable-shaped gate for regression tests |

No vendored serializer fork required while dep stays ≥ 0.215 with this gate. Pure helper documents densable 1:1 and fails loudly if product later reimplements serialization without the gate.

## Tests

`src/utils/telemetry/__tests__/prometheusUnitLine.216.test.ts`
