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

const base = 'docs/upstream-extraction/v2.1.247/snippets/'

console.log('==== pn before Ie ====')
console.log(ascii(210539800, 210540400))

console.log('\n==== Fr ceiling ====')
for (const n of [
  'function Fr(e,n){return y([e,n]',
  'function Cr(e){return b()==="windows"',
  'GIT_CEILING_DIRECTORIES',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 5))
  for (const i of hits.slice(0, 2)) console.log(ascii(i, i + 200))
}

console.log('\n==== J4n ====')
for (const n of ['function J4n(', 'J4n=function', 'function J4n(e', 'J4n(o,']) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 6))
  for (const i of hits.filter(i => i > 215240000 && i < 215280000).slice(0, 2)) {
    console.log(ascii(i - 20, i + 400))
  }
}

console.log('\n==== pXo full ====')
const px = buf.indexOf(Buffer.from('function pXo(e){'))
writeFileSync(base + 'gold-forged-pXo.txt', ascii(px, px + 900))
console.log(ascii(px, px + 900))

console.log('\n==== V hardened run ====')
for (const n of ['async function V(e,n,t)', 'reach:s', 'function V(e,n,{']) {
  console.log(n, allHits(n).filter(i => i > 210540000 && i < 210562000))
}

const v = allHits('async function V(e,').filter(
  i => i > 210540000 && i < 210562000,
)
for (const i of v) console.log(ascii(i, i + 500))
