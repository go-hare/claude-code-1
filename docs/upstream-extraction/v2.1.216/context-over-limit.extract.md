# densable 2.1.216 #35 — `/context` over-window warning + failed `/compact` as error

## Official

- `/context` shows an **explicit warning** when usage is over the context window
- Failed `/compact` is displayed as an **error** (not plain dim stdout)

## densable gold

### Ftn — over-limit copy (`function Ftn(e)`)

```js
function Ftn(e) {
  if (e.totalTokens <= e.rawMaxTokens) return null
  let t = pa(e.totalTokens - e.rawMaxTokens) // formatTokens(over)
  let r = pa(e.rawMaxTokens)
  if (e.autocompactSource === 'auto') {
    let o = Z.DISABLE_COMPACT ? '/clear' : '/compact or /clear'
    return `Context exceeds the ${r}-token limit by ${t} tokens — run ${o} to continue.`
  }
  let n = Z.DISABLE_COMPACT ? '/clear' : '/compact'
  return `Context is ${t} tokens past the ${r}-token compaction window — run ${n} to reduce usage.`
}
```

- **UI** (`ContextVisualization` / `_qo`): `Ftn(data)` → `<Text color="error" wrap="wrap">{msg}</Text>` under title.
- **Markdown** (`$tn`): after Tokens line, if Ftn → `**Over limit:** ${g}\n`.

### `autocompactSource` (densable `p7().source`)

Returned on context analysis as `autocompactSource:g` with `rawMaxTokens:m` where `m` is the **displayed** window (model window, optionally capped by `CLAUDE_CODE_AUTO_COMPACT_WINDOW` → source `"env"`). Full densable p7 also has settings/clientdata/experiment/model-default; local land wires model + env (matches product-facing path).

### Failed `/compact` as error

- Compact command throws (`Q7` / `Error during compaction: …` / exhausted / media).
- Local command catch wraps: `<local-command-stderr>${String(e)}</local-command-stderr>`.
- UI `uBo` / `$pn`: stderr path uses `isError:!0` → `color:"error"` (not Markdown dim).

## Local land

| File | Change |
|------|--------|
| `src/utils/contextOverLimit.ts` | pure `formatContextOverLimitWarning` (Ftn) |
| `src/utils/analyzeContext.ts` | `autocompactSource` on `ContextData`; env window cap |
| `src/components/ContextVisualization.tsx` | red Ftn line under title |
| `src/commands/context/context-noninteractive.ts` | `**Over limit:**` markdown |
| `src/components/messages/UserLocalCommandOutputMessage.tsx` | stderr `isError` → `color="error"` |
| tests | `contextOverLimit.216.test.ts` |

## Tests

`src/utils/__tests__/contextOverLimit.216.test.ts`
