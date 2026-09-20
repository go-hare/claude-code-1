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

// on in sn module — map in er()
for (const n of ['function on(', 'on=_o', 'on=function']) {
  const hits = allHits(n).filter(i => i > 210560000 && i < 210610000)
  console.log(n, hits)
  for (const i of hits.slice(0, 3)) console.log('  ', i, ascii(i, i + 120))
}

// mn / er in _465
for (const n of [
  'async function mn(',
  'function mn(',
  'async function er(e,s)',
  'async function er(e,t)',
]) {
  const hits = allHits(n).filter(i => i > 210700000 && i < 210744000)
  console.log(n, hits)
  for (const i of hits) console.log('  ', i, ascii(i, i + 220))
}

// K4n export from _583
console.log('\n==== _583 K4n ====')
console.log(ascii(212821050, 212821200))
const k4nExp = allHits('K4n as').concat(allHits(' as K4n'))
console.log('K4n names', k4nExp.slice(0, 5), k4nExp[0] && ascii(k4nExp[0] - 30, k4nExp[0] + 20))

// find JJb or whatever before as K4n
console.log(ascii(212820980, 212821140))

// Wzd function
for (const n of ['function Wzd(', 'Wzd as bp']) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 4))
}

// u0c / $l
for (const n of ['u0c as $l', 'function u0c(', ' as u0c}']) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 4))
}

// an() temp parent in _465
for (const n of ['function an()', 'function an(e)']) {
  const hits = allHits(n).filter(i => i > 210700000 && i < 210744000)
  console.log(n, hits)
  for (const i of hits) console.log('  ', ascii(i, i + 160))
}

// gXo
for (const n of ['function gXo(', 'gXo=()']) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 5))
  for (const i of hits.slice(0, 2)) console.log('  ', ascii(i, i + 200))
}
