import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function ascii(start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function allHits(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function extractFrom(offset, max = 4000) {
  let i = offset
  let depth = 0
  let seen = false
  while (i < offset + max && i < buf.length) {
    if (buf[i] === 123) {
      depth++
      seen = true
    } else if (buf[i] === 125) {
      depth--
      if (seen && depth === 0) return ascii(offset, i + 1)
    }
    i++
  }
  return ascii(offset, Math.min(offset + max, buf.length))
}

const base = 'docs/upstream-extraction/v2.1.247/snippets/'
const LO = 208200000
const HI = 208270000

console.log('==== _752 no-optional-locks ====')
for (const i of [208249915, 208250127]) {
  console.log('\n@', i)
  console.log(ascii(i - 120, i + 200))
}

console.log('\n==== _ = Fe / w = xe / ji = Bn in _752 ====')
for (const n of [
  'var _=["--no-optional-locks"]',
  '_=["--no-optional-locks"]',
  'function w(){',
  'w=memoize',
  'function ji(',
  'function ji(e,n){',
  'ji=function',
  'function _(e){',
]) {
  const hits = allHits(n).filter(i => i > LO && i < HI)
  console.log(n, hits)
  for (const i of hits.slice(0, 2)) console.log('  ', ascii(i, i + 280))
}

console.log('\n==== neighborhood 208248800-208252000 ====')
console.log(ascii(208248800, 208252200))

console.log('\n==== $e ni Qfd around 207220 ====')
// find function ni in _825
for (const n of [
  'function ni(e,n){',
  'function ni(e,t){',
  'ni=function',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 8))
  for (const i of hits.filter(x => x > 207180000 && x < 207230000).slice(0, 3)) {
    console.log('  ', i, ascii(i, i + 300))
  }
}

console.log('\n==== jn Rf WJc ====')
for (const n of ['function Rf(', 'function Rf(e,n){']) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 6))
  for (const i of hits.filter(x => x > 207280000 && x < 207330000).slice(0, 2)) {
    console.log('  ', i, extractFrom(i, 400))
  }
}

console.log('\n==== j ot PYb / pn / R y ====')
for (const n of [
  'function ot(){',
  'function pn(){',
  'function y(e,n){',
]) {
  const hits = allHits(n).filter(i => i > 207500000 && i < 210570000)
  console.log(n, hits.slice(0, 8))
  for (const i of hits.slice(0, 2)) console.log('  ', i, ascii(i, i + 220))
}

console.log('\n==== Ee y5c exec ====')
console.log(ascii(207523800, 207524520))
