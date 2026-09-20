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

console.log('==== function pn ====')
for (const i of allHits('function pn(){').filter(i => i > 210530000 && i < 210542000)) {
  console.log(i, ascii(i, i + 350))
}

console.log('\n==== J4n assignment ====')
for (const n of ['J4n=', ' as J4n', 'J4n as']) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 8))
  for (const i of hits.filter(i => i > 215200000 && i < 215280000).slice(0, 3)) {
    console.log(ascii(i - 80, i + 200))
  }
}

console.log('\n==== mXo home root ====')
for (const n of ['mXo={', 'var mXo', 'mXo=', 'home_root', 'refused_home']) {
  const hits = allHits(n).filter(i => i > 215240000 && i < 215280000)
  console.log(n, hits)
  for (const i of hits.slice(0, 2)) console.log(ascii(i, i + 400))
}

console.log('\n==== V( in _583 around 210548 ====')
for (const n of ['async function V(', 'function V(e,n,t){', 'V=async']) {
  const hits = allHits(n).filter(i => i > 210540000 && i < 215000000)
  console.log(n, hits.slice(0, 6))
}

console.log('\n==== Qi after ident / checkout linked ====')
const qi = buf.indexOf(Buffer.from('async function Qi(e,n,{linkedTrees'))
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-forged-K4n-Qi-full.txt',
  ascii(qi, qi + 3500),
)
console.log('Qi', qi, 'len dump 3500')

console.log('\n==== Ue We unique ====')
for (const n of ['function Ue(e,n){if(e===void 0)', 'async function We(e){try{let n=await me']) {
  console.log(n, allHits(n))
}
