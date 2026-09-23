import {
  loadSea,
  allHits,
  asciiSlice,
  extractFnAt,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()
const qv = 189708495

const win = asciiSlice(buf, qv - 80000, qv + 3000)
for (const pat of [
  'function Wr(',
  'Wr=se',
  'import{se',
  'chunk-49rj54ya',
  'var Wr=',
  'Wr=',
  ',Wr,',
]) {
  let i = 0
  let c = 0
  while ((i = win.indexOf(pat, i)) >= 0 && c < 8) {
    console.log(pat, 'rel', i, 'abs', qv - 80000 + i)
    console.log(win.slice(Math.max(0, i - 100), i + 160))
    console.log('---')
    i += pat.length
    c++
  }
}

console.log('\n=== se chunk importers ===')
for (const h of allHits(buf, 'chunk-49rj54ya.js').slice(0, 20)) {
  console.log('@', h)
  console.log(asciiSlice(buf, h - 120, h + 220))
  console.log('---')
}

console.log('\n=== import patterns ===')
for (const p of [
  '{se as Wr}',
  'Wr=se',
  'se as Wr',
  'import{se as',
  'import{se}',
  '{se}',
]) {
  const hits = allHits(buf, p)
  console.log(p, hits.length, hits.slice(0, 10).join(','))
}

// qv body uses Wr — find nearest assignment of Wr before qv in binary
const before = asciiSlice(buf, qv - 200000, qv)
const markers = [
  'function Wr(t)',
  'function Wr(e)',
  'Wr=se',
  'Wr=t=>',
  'Wr=(t)',
  'var Wr=',
  'let Wr=',
  'const Wr=',
]
for (const m of markers) {
  const idx = before.lastIndexOf(m)
  console.log('last', m, idx >= 0 ? qv - 200000 + idx : -1)
  if (idx >= 0) {
    console.log(before.slice(idx, idx + 200))
  }
}

// italic / screen TERM fix #36 — relevant to blank/highlight?
console.log('\n=== screen italic ===')
for (const n of [
  'startsWith("screen")',
  "startsWith('screen')",
  'TERM',
  'italic',
]) {
  // skip huge TERM — only screen
}
for (const n of [
  'startsWith("screen")',
  "startsWith('screen')",
  '.startsWith("screen")',
]) {
  const hits = allHits(buf, n)
  console.log(n, hits.length)
  for (const h of hits.slice(0, 3)) {
    console.log(asciiSlice(buf, h - 200, h + 400))
  }
}

console.log('\nBun widths:')
console.log(
  '23FA',
  Bun.stringWidth('\u23FA', { ambiguousIsNarrow: true }),
  Bun.stringWidth('\u23FA', { ambiguousIsNarrow: false }),
)
console.log(
  '23FA+FE0F',
  Bun.stringWidth('\u23FA\uFE0F', { ambiguousIsNarrow: true }),
)
console.log(
  '25CF',
  Bun.stringWidth('\u25CF', { ambiguousIsNarrow: true }),
  Bun.stringWidth('\u25CF', { ambiguousIsNarrow: false }),
)
