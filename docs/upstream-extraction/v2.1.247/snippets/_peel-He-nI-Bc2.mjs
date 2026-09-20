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

console.log('==== _604 around He/nI ====')
console.log(ascii(210528900, 210529400))

console.log('\n==== _604 export ====')
for (const n of [
  'export{m as JVb',
  'm as JVb',
  'd as JVb',
  ' as JVb,',
  'function m()',
  'function d()',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 8))
  for (const i of hits.slice(0, 3)) {
    console.log(' ', i, ascii(i - 40, i + 180).replace(/\n/g, '\\n'))
  }
}

console.log('\n==== TCt import nI / Bc ====')
console.log(ascii(212826450, 212826650))
console.log('---')
console.log(ascii(212858580, 212858720))

console.log('\n==== _583 He/Bc? ====')
for (const n of [' as He,', ' as nI,', ' as Bc,', 'JVb as', 'Pzd as']) {
  const hits = allHits(n).filter(i => i > 210550000 && i < 210580000)
  console.log('583win', n, hits)
}

console.log('\n==== function C / R offsets ====')
for (const n of [
  'function C(t,n){let e=t.indexOf(n)',
  'function R(t){return C(t,',
]) {
  const hits = allHits(n)
  console.log(n, hits)
}

console.log('\n==== _583 module header / exports around to/X4n ====')
const x4n = allHits('async function to(')
console.log('async function to(', x4n.slice(0, 6))
const x4n2 = allHits('async function X4n(')
console.log('async function X4n(', x4n2.slice(0, 6))
