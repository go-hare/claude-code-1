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

function extractFrom(offset, max = 12000) {
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

// JJb export from _583
const jjb = allHits('JJb as')
console.log('JJb as', jjb.slice(0, 6))
const jjbExp = buf.indexOf(Buffer.from(' as JJb'))
console.log('as JJb', jjbExp, jjbExp > 0 ? ascii(jjbExp - 80, jjbExp + 20) : '')

// function that becomes JJb — search _583 module // @bun before 210609? 
// _583 imports in gold-forged-mod-head at 210706: IJb SJb VJb from _583
// K4n is JJb imported at 212821 — later module

for (const n of ['async function JJb', 'function JJb(', 'JJb=async']) {
  console.log(n, allHits(n).slice(0, 5))
}

// find export JJb in _583 file
const exp583 = allHits(' as JJb')
console.log('as JJb all', exp583)
for (const i of exp583) console.log(ascii(i - 60, i + 15))

writeFileSync(`${outDir}/gold-forged-mn.txt`, extractFrom(210741135, 4000))
console.log('\n==== mn ====')
console.log(ascii(210741135, 210742200))

writeFileSync(`${outDir}/gold-forged-er.txt`, extractFrom(210740955, 400))

// Wzd
const wzd = buf.indexOf(Buffer.from('function Wzd('))
console.log('\nWzd', wzd)
// search Wzd=
for (const n of ['function Wzd', 'Wzd=function', 'function bp(e,t)']) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 8))
  for (const i of hits.slice(0, 2)) console.log('  ', ascii(i, i + 200))
}

// u0c
for (const n of ['u0c as', ' as u0c,', ' as u0c}']) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 6))
  for (const i of hits.slice(0, 2)) console.log('  ', ascii(i - 40, i + 30))
}

// V.CLAUDE_CODE_LEGACY
console.log('\n==== gXo V ====')
console.log(ascii(215247900, 215248100))
const vImp = buf.lastIndexOf(Buffer.from('V}from'), 215247940)
console.log('V}from', vImp, vImp > 0 ? ascii(vImp - 80, vImp + 40) : '')
for (const n of [',V}from', ' as V}from', '{V}from']) {
  const hits = allHits(n).filter(i => i > 215200000 && i < 215248000)
  console.log(n, hits)
}

// on in _580 near sn — maybe imported
console.log('\n==== _580 on before sn ====')
console.log(ascii(210580000, 210583420).slice(-500))
