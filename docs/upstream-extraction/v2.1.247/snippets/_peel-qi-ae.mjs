import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

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

const lo = 208216739
const hi = 208263944

writeFileSync(`${outDir}/gold-11-ae-mod-head.txt`, ascii(208248500, 208253000))

console.log('==== imports / consts just before Dr ====')
console.log(ascii(208250800, 208253000))

console.log('\n==== function hits in _752 window ====')
for (const n of [
  'function rt(',
  'function b(',
  'function J(',
  'function se(',
  'function F(',
  'function xo(',
  'function Po(',
  'function vo(',
  'function Co(',
  'var Fo=',
  'Fo=',
  'Io=',
  'Ir=',
  'be=',
  'var be=',
  'var Io=',
  'var Ir=',
  'ko=',
]) {
  const hits = allHits(n).filter(i => i >= lo && i < hi)
  console.log(n, hits.slice(0, 8))
  for (const i of hits.slice(0, 3)) {
    const s = n.startsWith('function')
      ? extractFrom(i, 1200)
      : ascii(i, i + 160)
    console.log('  ', i, s.slice(0, 220).replaceAll('\n', ' '))
  }
}

console.log('\n==== export list names for Fo Io Ir be ko rt ====')
const exp = ascii(208262800, 208263944)
console.log(exp)
