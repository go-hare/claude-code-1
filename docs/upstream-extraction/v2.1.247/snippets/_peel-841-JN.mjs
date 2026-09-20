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

const so = buf.indexOf(Buffer.from('function $o(t,e){if(!J(t))return!1'))
const ko = buf.indexOf(Buffer.from('function ko(t,e){let r=c(e,t);if(ae(t,e)||ae(r,e))return!0'))
console.log({ so, ko })
writeFileSync(`${outDir}/gold-11-dollar-o.txt`, extractFrom(so, 800))
writeFileSync(`${outDir}/gold-11-ko-full.txt`, extractFrom(ko, 800))

console.log('\n==== $o neighborhood ====')
console.log(ascii(so - 400, so + 500))

console.log('\n==== function J / N / c / ae in _841 window ====')
const lo = 206880000
const hi = 206930000
for (const n of [
  'function J(',
  'function J()',
  'function N(',
  'function N()',
  'function c(',
  'function ae(',
  'J=function',
  'N=function',
]) {
  const hits = allHits(n).filter(i => i >= lo && i < hi)
  console.log(n, hits)
  for (const i of hits.slice(0, 3)) console.log('  ', i, ascii(i, i + 160))
}

console.log('\n==== imports of J/N before $o ====')
for (const n of ['as J,', 'as J}', 'as N,', 'as N}', 'Pxd', 'function J(){return!1}']) {
  const hits = allHits(n).filter(i => i > so - 30000 && i < so)
  console.log(n, hits.slice(-6))
  for (const i of hits.slice(-2)) console.log('  ', i, ascii(i - 50, i + 80))
}
