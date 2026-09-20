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

console.log('==== Ptc as on import ====')
console.log(ascii(210567040, 210567180))

const ptc = allHits(' as Ptc')
console.log('as Ptc', ptc.slice(0, 6))
for (const i of ptc.slice(0, 4)) console.log(ascii(i - 40, i + 15))

for (const n of ['function Ptc(', 'Ptc=function']) {
  console.log(n, allHits(n).slice(0, 5))
}

// _604 export Ptc
const exp = buf.indexOf(Buffer.from(' as Ptc'))
console.log('first as Ptc', exp, exp > 0 ? ascii(exp - 80, exp + 20) : '')

// Wzd in _845
const wzdExp = allHits(' as Wzd')
console.log('as Wzd', wzdExp)
for (const i of wzdExp.slice(0, 4)) console.log(ascii(i - 50, i + 15))

// common truncate: function X(e,t){return t<=0?"":e.length<=t?e
for (const n of [
  'function bp(e,t){return',
  'function Wzd(e,t)',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 5))
  for (const i of hits.slice(0, 2)) console.log(ascii(i, i + 150))
}

// _845 Wzd original name from export line like `foo as Wzd`
console.log('\n==== _845 export Wzd ====')
const w845 = buf.indexOf(Buffer.from('Wzd as bp'))
console.log(ascii(w845 - 200, w845 + 20))
