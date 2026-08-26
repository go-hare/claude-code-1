# densable 2.1.212 — #40 bare `/btw` reopens last side-question panel

Changelog:

> Bare `/btw` reopens the most recent side-question panel instead of only printing usage

## densable symbols

| densable | role |
|----------|------|
| `VI_=20` | max history entries |
| `Abp` | `createBtwHistoryState` → `{history:[]}` |
| `aNt` | process-global history state |
| `lNt` / `getBtwHistory` | `() => aNt.history` |
| `zI_` / `clearBtwHistory` | `aNt.history=[]` |
| `zOo` / `resetBtwHistory` | `aNt.history=e` |
| `Scn` / `appendBtwHistory` | push `{question,response}` + `slice(-VI_)` |
| `qI_` | test setter for global state |
| `xhr` / `runSideQuestion` | fork Q&A; `threadHistory` prefixes prior pairs; append on real success |
| `KI_` | extract response + `synthetic` flag |
| `IO_` | command handler |
| `yXs` | panel UI (`initialResponse`, history chrome, keys) |
| `wNo=5` | max history rows shown |
| `TNo=3` | scroll step |

### IO_ (verbatim logic)

```js
async function IO_(e, t, r) {
  let n = r?.trim()
  if (!n) {
    let o = lNt().at(-1)
    if (!o) return e('Usage: /btw <your question>', { display: 'system' }), null
    return _d.jsx(yXs, {
      question: o.question,
      initialResponse: o.response,
      context: t,
      onDone: e,
    })
  }
  return (
    await cr(o => ({ ...o, btwUseCount: o.btwUseCount + 1 })),
    _d.jsx(yXs, { question: n, context: t, onDone: e })
  )
}
```

### History module exports

```
runSideQuestion, resetBtwHistory, getBtwHistory, findBtwTriggerPositions,
createBtwHistoryState, clearBtwHistory, appendBtwHistory,
_setGlobalBtwHistoryStateForTesting
```

### xhr append rule

```js
if (o && c && !u) Scn(e, c) // threadHistory && response && !synthetic
```

### yXs reopen / keys

- `initialResponse !== undefined` → skip fetch; seed `response`
- history list init: `initialResponse === undefined ? lNt() : lNt().slice(0,-1)`
- `←/→` browse history window of last `wNo=5`; `x` clear (optionally keep current); `c` copy; `f` fork; esc/space/enter dismiss

### Command meta

```js
{
  type: 'local-jsx',
  name: 'btw',
  description: 'Ask a quick side question without interrupting the main conversation',
  immediate: true,
  argumentHint: '[question]',
  thinClientDispatch: 'control-request', // product may omit if not wired
}
```

## Local alignment

| densable | local | status |
|----------|-------|--------|
| history ring | `src/utils/sideQuestion.ts` `getBtwHistory` / `appendBtwHistory` / … | **HAVE** |
| xhr thread + append | `runSideQuestion({ threadHistory })` | **HAVE** |
| IO_ bare reopen | `src/commands/btw/btw.tsx` `call` | **HAVE** |
| yXs initialResponse + history UI | `BtwSideQuestion` | **HAVE** |
| argumentHint `[question]` | `src/commands/btw/index.ts` | **HAVE** |

## Related files

- `src/utils/sideQuestion.ts`
- `src/commands/btw/btw.tsx`
- `src/commands/btw/index.ts`
- `src/utils/__tests__/btwHistory.212.test.ts`
