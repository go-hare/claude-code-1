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

console.log('==== Rld export / function ====')
for (const n of [' as Rld', 'Rld as vn', 'function Rld']) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 6))
  for (const i of hits.slice(0, 3)) console.log(ascii(i - 80, i + 200))
}

console.log('\n==== _837 around Rld ====')
const rld = buf.indexOf(Buffer.from('Rld as vn'))
console.log(ascii(rld - 40, rld + 40))

// _837 typically search CLAUDE_CONFIG near 2083-2084
console.log('\n==== CLAUDE_CONFIG in 2082-2085 ====')
for (const i of allHits('CLAUDE_CONFIG_DIR').filter(
  i => i > 208200000 && i < 208500000,
)) {
  console.log(i, ascii(i - 100, i + 180))
}

console.log('\n==== _843 syd / tyd / xyd ====')
const i843 = buf.indexOf(Buffer.from('syd as Mn,tyd as y,xyd as Z'))
console.log('import', i843, ascii(i843 - 20, i843 + 80))

for (const n of [' as syd}', 'syd as Mn', 'function y(', 'function Z(']) {
  console.log(n, allHits(n).slice(0, 4))
}

// _843 module start - search export syd from that pack
const exp = allHits(' as syd')
for (const i of exp) console.log('as syd', i, ascii(i - 100, i + 30))

console.log('\n==== qt import in _583 ====')
const qtImp = allHits(' as qt')
for (const i of qtImp.filter(i => i > 210520000 && i < 210533000)) {
  console.log(i, ascii(i - 80, i + 20))
}

console.log('\n==== qt(d(n.commonDir ====')
const use = buf.indexOf(Buffer.from('qt(d(n.commonDir'))
console.log(use, ascii(use - 80, use + 80))

// local const qt=
for (const n of ['qt=async', 'const qt=', 'let qt=', 'qt=Ae(']) {
  console.log(n, allHits(n).slice(0, 8))
}
