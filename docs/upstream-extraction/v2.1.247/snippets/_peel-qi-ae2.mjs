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

function extractFrom(offset, max = 2500) {
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

const lo = 208200000
const hi = 208264000

for (const n of [
  'function F(e,t)',
  'function F(e)',
  'function J(e,t)',
  'function J(i,n)',
  'F=function',
  'J=function',
  'as F}',
  'as F,',
  'as J}',
  'as J,',
]) {
  const hits = allHits(n).filter(i => i >= lo && i < hi)
  console.log(n, hits)
  for (const i of hits.slice(0, 4)) {
    console.log('  ', i, ascii(Math.max(lo, i - 50), i + 180))
  }
}

// import of F / J near 208252
console.log('\n==== 2k before path import ====')
console.log(ascii(208249800, 208252200))

writeFileSync(
  `${outDir}/gold-11-ae-regexes.txt`,
  ascii(208262380, 208262520),
)
