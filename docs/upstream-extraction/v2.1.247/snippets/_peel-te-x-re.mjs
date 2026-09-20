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

console.log('==== as te 21052-21054 ====')
for (const i of allHits(' as te').filter(i => i > 210520000 && i < 210542000)) {
  console.log(i, ascii(i - 80, i + 20))
}

console.log('\n==== function x / re / G / F / mn / Et / kt / ye ====')
for (const n of [
  'function x(e,n){return',
  'function re(e){',
  'function mn(){',
  'var F=',
  'F=sep',
  'join as G',
  'normalize as te',
  'win32 as',
  'realpath as Et',
  'stat as kt',
  'lstat as ye',
  'readlink as yt',
  'access as ht',
  'parse as Dt',
  'dirname as bt',
  'relative as Tt',
]) {
  const hits = allHits(n).filter(i => i > 210500000 && i < 210542500)
  console.log(n, hits)
  for (const i of hits.slice(0, 1)) console.log(ascii(i - 40, i + 80))
}

console.log('\n==== imports just before gn @210533599 ====')
console.log(ascii(210532800, 210533650))

console.log('\n==== ie link remainder ====')
const ie = buf.indexOf(Buffer.from('async function ie(e,n,t=Ot'))
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-forged-ie-full.txt',
  ascii(ie, ie + 2200),
)
console.log('ie', ie)
