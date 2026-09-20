import { readFileSync } from 'fs'

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

console.log('==== _583 fs imports ====')
for (const n of [
  'symlink as qt',
  'cp as qt',
  'link as qt',
  'from"fs/promises"',
  'from"fs"',
  'from"node:fs/promises"',
  'from"node:fs"',
]) {
  const hits = allHits(n).filter(i => i > 210500000 && i < 210533000)
  console.log(n, hits)
  for (const i of hits.slice(0, 3)) console.log(ascii(i - 80, i + 40))
}

console.log('\n==== symlink as near 21053 ====')
for (const n of ['symlink as ', 'import{symlink', '{symlink as']) {
  console.log(n, allHits(n).slice(0, 10))
}

// module containing async function to — first import
console.log('\n==== 2k before function Ye ====')
const ye = buf.indexOf(Buffer.from('function Ye(e){if(!we(e))return null'))
console.log('Ye', ye)
console.log(ascii(ye - 2500, ye + 80))

console.log('\n==== qt as anywhere 2104-2106 ====')
for (const i of allHits(' as qt').filter(i => i > 210400000 && i < 210600000)) {
  console.log(i, ascii(i - 60, i + 15))
}
for (const i of allHits('qt as ').filter(i => i > 210400000 && i < 210600000)) {
  console.log('qt as', i, ascii(i - 20, i + 40))
}
