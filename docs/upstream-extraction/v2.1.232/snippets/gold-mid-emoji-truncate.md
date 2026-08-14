# densable 2.1.232 #28 — mid-emoji truncation

## Changelog

> Fixed mid-emoji truncation producing broken/garbled characters

## densable gold (SEA ~286445065 / ~287084123)

### Display-width path (`ts` / `Zz` / `n6e` / `kl`)

Grapheme-segmenter loop + `stringWidth`-equivalent (`dr`), never splits a segment:

```js
function ts(e, t) { // truncate end + …
  if (dr(e) <= t) return e
  if (t <= 1) return "…"
  let r = 0, n = ""
  for (let { segment: o } of dv().segment(e)) {
    let i = dr(o)
    if (r + i > t - 1) break
    n += o; r += i
  }
  return n + "…"
}
// Zz = start-truncate; n6e = no-ellipsis; kl wraps singleLine
```

### Code-unit path (`AP_` / `and` / densable `Jd`)

```js
function AP_(e, t) { // grapheme accumulate by UTF-16 length
  let r = ""
  for (let { segment: n } of dv().segment(e)) {
    if (r.length + n.length > t) break
    r += n
  }
  return r
}
function and(e, t) {
  let r = AP_(e, t)
  if (r.length > 0) return r
  let n = Math.min(t, e.length)
  let o = e.charCodeAt(n - 1)
  if (o >= 55296 && o <= 56319) n -= 1 // drop lone high surrogate
  return e.slice(0, n)
}
```

## Local (HAVE)

| densable | local |
| --- | --- |
| `ts` / `Zz` / `n6e` / `kl` | `truncate.ts` `truncateToWidth` / `truncateStartToWidth` / `truncateToWidthNoEllipsis` / `truncate` |
| `and` fallback / `Jd` | `stringUtils.ts` `truncateCodeUnitsSafe` |
| IDE selection | `truncateIdeSelectionContent` (218) |

Tests: `truncate.test.ts` (ZWJ family mid-cut), `stringUtils.test.ts` (high surrogate drop), `ideSelectionTruncate.218.test.ts`.
