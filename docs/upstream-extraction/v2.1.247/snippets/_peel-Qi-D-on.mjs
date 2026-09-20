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

function extractFrom(offset, max = 15000) {
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

// Qi as JJb in _583 @210565032 — find function Qi before that
for (const n of ['async function Qi(', 'function Qi(e', 'async function Qi(e']) {
  const hits = allHits(n).filter(i => i > 210480000 && i < 210565032)
  console.log(n, hits)
  for (const i of hits) console.log('  ', i, ascii(i, i + 180))
}

const qi = allHits('async function Qi(').filter(i => i > 210500000 && i < 210565000)
console.log('Qi candidates', qi)
for (const i of qi) {
  writeFileSync(`${outDir}/gold-forged-K4n-Qi.txt`, extractFrom(i, 12000))
  console.log('wrote Qi', i, extractFrom(i, 400).slice(0, 300))
}

// D as u0c @207251754
console.log('\n==== D as u0c ====')
console.log(ascii(207251650, 207251850))
for (const n of ['function D(e,t)', 'function D(e)', 'function D(t,n)']) {
  const hits = allHits(n).filter(i => i > 207200000 && i < 207251754)
  console.log(n, hits.slice(-5))
  for (const i of hits.slice(-2)) console.log('  ', i, ascii(i, i + 160))
}

// LEGACY_BUNDLE
const lb = allHits('CLAUDE_CODE_LEGACY_BUNDLE')
console.log('\nLEGACY_BUNDLE', lb)
for (const i of lb.slice(0, 6)) console.log(ascii(i, i + 80))

// on= in _580 before sn - look for map(on) binding
const mapOn = buf.lastIndexOf(Buffer.from('function on'), 210583410)
console.log('\nlast function on before sn', mapOn, mapOn > 0 ? ascii(mapOn, mapOn + 80) : '')
const onImp = buf.lastIndexOf(Buffer.from('as on}'), 210583410)
const onImp2 = buf.lastIndexOf(Buffer.from('as on,'), 210583410)
console.log('as on}', onImp, onImp > 0 ? ascii(onImp - 40, onImp + 20) : '')
console.log('as on,', onImp2, onImp2 > 0 ? ascii(onImp2 - 40, onImp2 + 20) : '')
