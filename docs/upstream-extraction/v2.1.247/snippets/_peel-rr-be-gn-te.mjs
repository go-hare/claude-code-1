import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

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

const needles = [
  'async function rr(e,n,t){',
  'async function be(e,n,t){',
  'async function De(e,n){',
  'function gn(',
  'function ke(',
  'function se(e){',
  'function T(e,n){',
  'function te(',
  'function wn(',
  'async function It(',
  'function Rt(',
  'function St(',
  'function Pt=',
  'Pt=/^[A-Za-z]',
]

for (const n of needles) {
  const hits = allHits(n).filter(i => i > 210532000 && i < 210560000)
  console.log(n, hits)
}

function dumpFn(startNeedle, out, max = 3500) {
  const hits = allHits(startNeedle).filter(i => i > 210532000 && i < 210560000)
  if (hits.length !== 1) {
    console.log('NOT UNIQUE', startNeedle, hits)
    if (hits[0]) writeFileSync(out, ascii(hits[0], hits[0] + max))
    return
  }
  writeFileSync(out, ascii(hits[0], hits[0] + max))
  console.log('wrote', out, hits[0])
}

const base = 'docs/upstream-extraction/v2.1.247/snippets/'
dumpFn('async function rr(e,n,t){', base + 'gold-forged-rr.txt', 4500)
dumpFn('async function be(e,n,t){', base + 'gold-forged-be.txt', 2500)
dumpFn('async function De(e,n){', base + 'gold-forged-De.txt', 800)
dumpFn('function gn(', base + 'gold-forged-gn.txt', 1500)
dumpFn('function ke(', base + 'gold-forged-ke.txt', 800)

console.log('\n==== te/wn/It/Rt/se/T/Pt in _583 ====')
for (const n of [
  'function te(e',
  'function te(e,n',
  'function wn(e)',
  'async function It(e)',
  'function Rt(e)',
  'function se(e){return',
  'function T(e,n){',
  'function St(e)',
  'var Pt=',
]) {
  const hits = allHits(n).filter(i => i > 210532000 && i < 210552200)
  console.log(n, hits)
  for (const i of hits.slice(0, 2)) console.log(ascii(i, i + 280))
}

console.log('\n==== _583 fs/promises import ====')
console.log(ascii(210540900, 210541500))
