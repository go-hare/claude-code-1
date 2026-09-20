import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const base = 'docs/upstream-extraction/v2.1.247/snippets/'

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

for (const n of [
  'OJb as JS',
  ' as OJb',
  'OJb:',
  'PJb as Y4n',
  ' as PJb',
  'RJb as Z4n',
  ' as RJb',
  'function hCt(',
  'async function Kn(',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 8))
  for (const i of hits.slice(0, 2)) console.log(ascii(i - 60, i + 120))
}

// _583 export map near K4n
const exp = allHits('OJb as JS')[0]
console.log('\n==== TCt import chunk ====')
console.log(ascii(exp - 400, exp + 200))

const exp583 = allHits('OJb:()=>').filter(i => i > 210520000 && i < 210570000)
console.log('OJb:()=>', exp583)
for (const i of exp583) console.log(ascii(i - 200, i + 250))

const y4 = allHits('PJb:()=>').filter(i => i > 210520000 && i < 210570000)
console.log('PJb:()=>', y4)
for (const i of y4) console.log(ascii(i - 80, i + 80))
