import {
  loadSea,
  allHits,
  asciiSlice,
  extractFnAt,
  sha,
} from './_peel-251-helpers.mjs'

const buf = loadSea()

const gGe = 189563106
console.log('=== window before gGe ===')
console.log(asciiSlice(buf, gGe - 8000, gGe + 400))

// Find class Pm
for (const n of [
  'class Pm',
  'Pm=class',
  'function Pm',
  'measure(t)',
  'measure(e)',
  '#e=new',
]) {
  const hits = allHits(buf, n)
  const near = hits.filter(h => Math.abs(h - gGe) < 100000)
  console.log(n, 'total', hits.length, 'near', near.slice(0, 8).join(','))
}

// Extract Pm from nearby
const win = asciiSlice(buf, gGe - 15000, gGe + 2000)
const classIdx = win.lastIndexOf('class Pm')
const fnIdx = win.lastIndexOf('Pm=')
console.log('class Pm idx', classIdx, 'Pm= idx', fnIdx)
if (classIdx >= 0) {
  console.log(win.slice(classIdx, classIdx + 3500))
}

// Also search measure method body with emoji / FE0F / 1fa70
const measureHits = allHits(buf, 'measure(t){')
for (const h of measureHits) {
  if (Math.abs(h - gGe) > 50000) continue
  console.log('\nmeasure @', h)
  console.log(asciiSlice(buf, h - 100, h + 1500))
}

// Look for char width table / emoji in Pm area
const area = asciiSlice(buf, gGe - 30000, gGe + 5000)
for (const pat of [
  'FE0F',
  '1fa70',
  '1FA70',
  '23FA',
  '\\u23FA',
  'emoji',
  'codePointAt',
  'ambiguousIsNarrow',
  'Bun.stringWidth',
  'stringWidth',
]) {
  let i = 0
  let c = 0
  while ((i = area.indexOf(pat, i)) >= 0 && c < 3) {
    console.log('AREA', pat, gGe - 30000 + i)
    console.log(area.slice(Math.max(0, i - 60), i + 200))
    console.log('---')
    i += pat.length
    c++
  }
}

// Compare local ink stringWidth / measure
console.log('\n=== local comparison placeholders ===')
