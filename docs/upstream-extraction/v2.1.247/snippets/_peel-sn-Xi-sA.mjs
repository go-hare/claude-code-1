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

function extractFrom(offset, max = 8000) {
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

// sn in _580 window ~210500000-210610000
for (const n of ['function sn(', 'function sn(e)', 'function sn(t)']) {
  const hits = allHits(n).filter(i => i > 210480000 && i < 210610000)
  console.log(n, hits)
  for (const i of hits) {
    console.log(ascii(i, i + 400))
    writeFileSync(`${outDir}/gold-forged-sn.txt`, extractFrom(i, 3000))
  }
}

writeFileSync(`${outDir}/gold-forged-Xi.txt`, extractFrom(210736023, 6000))
console.log('\n==== Xi ====')
console.log(ascii(210736023, 210737020))

console.log('\n==== sA + O4n ====')
console.log(ascii(215250900, 215251400))
for (const n of ['O4n=', 'nYn=', 'var O4n']) {
  const hits = allHits(n).filter(i => i > 215240000 && i < 215270000)
  console.log(n, hits)
  for (const i of hits) console.log(ascii(i, i + 80))
}
