# densable 2.1.212 — #44 transcript assistant reasoning effort

Changelog:

> Changed session transcripts to record the reasoning effort level on each assistant message

## densable shape (verbatim from SEA)

```js
// AR ≡ EFFORT_LEVELS; MPe ≡ isEffortLevel
function MPe(e) {
  return AR.includes(e)
}
// AR = ["low","medium","high","xhigh","max"]

// paramsFromContext / queryModel request builder:
let ra = Qa.output_config?.effort
Ie = typeof ra === 'string' && MPe(ra) ? ra : void 0
// return Qa (params)

// every AssistantMessage construction (stream content_block_stop,
// non-stream success, non-stream 404 fallback, keepPartialMessageOnAbort):
{
  type: 'assistant',
  uuid: ...,
  timestamp: ...,
  // ...
  ...Ie !== void 0 && { effort: Ie },
}
```

## densable rules

| rule | densable |
|------|----------|
| source | last request `params.output_config.effort` after configureEffort |
| type gate | `typeof ra === "string"` only |
| value gate | `MPe(ra)` / `AR.includes` |
| numeric | **not** recorded (`effort_override` ant-only stays off transcript) |
| stamp sites | stream stop, non-stream, non-stream fallback, partial-abort keep |

## Local mapping

| densable | local |
|----------|-------|
| `Ie` | `effortLevelForTranscript` in `queryModel` |
| `MPe` / `AR` | `isEffortLevel` / `EFFORT_LEVELS` |
| capture | `transcriptEffortFromOutputConfig(outputConfig)` in `paramsFromContext` |
| stamp | `...(effortLevelForTranscript !== undefined && { effort: ... })` on 3 AssistantMessage builds in `src/services/api/claude.ts` |

## Local files

- `src/utils/effort.ts` — `transcriptEffortFromOutputConfig` (pure Ie capture)
- `src/services/api/claude.ts` — capture after `configureEffortParams`; stamp stream / non-stream / 404 fallback
- `src/utils/__tests__/effort.test.ts` — densable Ie tests

## Gap notes

- densable also stamps `effort` on `keepPartialMessageOnAbort` partial assistant (`sdk` or flag). Local has no `keepPartialMessageOnAbort` path yet — when that gate is ported, re-use `effortLevelForTranscript` the same way (`...Ie!==void 0&&{effort:Ie}`).
- `AssistantMessage` index signature already admits `effort` without a dedicated field.
