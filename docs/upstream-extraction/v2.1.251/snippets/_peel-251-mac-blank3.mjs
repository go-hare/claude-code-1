import {
  loadSea,
  allHits,
  asciiSlice,
  extractFnAt,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()

// gGe near Wr @ 189693445
const wr = 189693445
const before = asciiSlice(buf, wr - 5000, wr + 800)
console.log('=== around Wr ===')
console.log(before)

for (const n of ['function gGe(', 'gGe=', 'function Pv(', 'function se(']) {
  const hits = allHits(buf, n)
  console.log('\n', n, hits.length, hits.slice(0, 8).join(','))
  for (const h of hits.slice(0, 3)) {
    if (Math.abs(h - wr) < 200000) {
      const ext = extractFnAt(buf, h, 3000)
      console.log(
        'near Wr',
        h,
        'dist',
        h - wr,
        ext.body?.slice(0, 400),
        'sha',
        sha(ext.body || ''),
      )
    }
  }
}

// Find gGe definition by searching backwards from Wr for "function gGe"
const idx = before.lastIndexOf('function gGe')
console.log('\nlast function gGe in window', idx)
if (idx >= 0) {
  console.log(before.slice(idx, idx + 500))
}

// Also search for gGe=se or similar aliases in ink chunk
const inkWin = asciiSlice(buf, wr - 150000, wr + 50000)
for (const pat of [
  'gGe=se',
  'gGe=se;',
  ',gGe=',
  'function gGe',
  'gGe=t=>',
  'Pv=se',
  'Pv=gGe',
  'import{se as gGe}',
  'se as gGe',
  '{se as',
]) {
  let i = 0
  let c = 0
  while ((i = inkWin.indexOf(pat, i)) >= 0 && c < 5) {
    console.log(pat, wr - 150000 + i)
    console.log(inkWin.slice(Math.max(0, i - 80), i + 120))
    i += pat.length
    c++
  }
}

// Compare our wrapWithSoftWrap vs official qv — extract full qv + callers softWrap type
const qvHits = allHits(buf, 'function qv(t,o,u)')
console.log('\nqv defs', qvHits)
for (const h of qvHits) {
  const ext = extractFnAt(buf, h, 6000)
  console.log('qv sha', sha(ext.body || ''), 'len', ext.body?.length)
  console.log(ext.body)
}

// softWrap packing — Pr / Ao bit packing used with ContinuationElidedSep
const diHits = allHits(buf, 'ContinuationElidedSep:2')
console.log('\ndi enum @', diHits)
for (const h of diHits) {
  console.log(asciiSlice(buf, h - 400, h + 800))
}

// Our local softWrap is boolean — official is 0/1/2. Check if select/copy path cares.
const ovHits = allHits(buf, 'function ov(t,o,u,c,h,m)')
console.log('\nov (select text?)', ovHits.length)
for (const h of ovHits.slice(0, 2)) {
  const ext = extractFnAt(buf, h, 4000)
  console.log(ext.body?.slice(0, 800))
}
