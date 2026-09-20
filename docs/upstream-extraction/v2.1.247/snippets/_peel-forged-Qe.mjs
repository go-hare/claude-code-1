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

function extractFrom(offset, max = 2000) {
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

const exp = 210527864
console.log('export nbhd', ascii(exp - 400, exp + 80))

const lo = 210480000
const hi = 210528000
for (const n of ['function Qe(', 'function Qe(e)', 'Qe=function']) {
  const hits = allHits(n).filter(i => i >= lo && i < hi)
  console.log(n, hits)
  for (const i of hits) {
    console.log('  ', i, ascii(i, i + 220))
    writeFileSync(`${outDir}/gold-forged-Qe.txt`, extractFrom(i, 2500))
  }
}

// 207048923 ee(e){return Qe(e)&&!U(e)} — maybe that's a different path helper
console.log('\n==== 207048 Qe ====')
console.log(ascii(207048800, 207049200))
