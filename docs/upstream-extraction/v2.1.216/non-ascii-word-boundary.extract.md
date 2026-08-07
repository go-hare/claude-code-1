# densable 2.1.216 #21 — Bash non-ASCII word boundaries

## Changelog

> Fixed Bash command parsing of non-ASCII characters to match real shell word boundaries

## densable gold

```js
function guu(e){
  return e>="a"&&e<="z"||e>="A"&&e<="Z"||e>="0"&&e<="9"
    ||e==="_"||e==="/"||e==="."||e==="-"||e==="+"||e===":"
    ||e==="@"||e==="%"||e===","||e==="~"||e==="^"||e==="?"
    ||e==="*"||e==="!"||e==="="||e==="["||e==="]"
    ||e>="\x80"
}
function h0g(e){ return guu(e)||e==="\\" }
```

SEA offset ~223612921.

## Gap

Local `isWordChar` in `src/utils/bash/bashParser.ts` had the same ASCII punct list but **omitted** `c >= '\x80'`.

Note: `parseBareWord` already accepts non-ASCII by exclusion (stops only on operators/whitespace). `nextToken` WORD path uses `isWordChar` — densable parity requires high-bit there too so both paths agree.

## Local port

`isWordChar`: append `|| c >= '\x80'` (densable `guu`).

## Tests

`src/utils/bash/__tests__/nonAsciiWordBoundary.216.test.ts`
