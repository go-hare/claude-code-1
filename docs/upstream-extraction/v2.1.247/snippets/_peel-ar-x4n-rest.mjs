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

for (const n of [
  'async function ar(',
  'function Ln(',
  'function cr(',
  'function lr(',
  'async function ie(',
  'function ie(',
  'function se(',
  'function Mn(',
  'function gn(',
  'function ke(',
  'function vn(',
  'function Rn(',
  'async function qt(',
  'function T(',
  'function qt(',
]) {
  const hits = allHits(n).filter(i => i > 210500000 && i < 210570000)
  console.log('\n====', n, hits.slice(0, 4))
  for (const i of hits.slice(0, 1)) console.log(ascii(i, i + 450))
}

const ar = allHits('async function ar(').filter(
  i => i > 210500000 && i < 210570000,
)
if (ar[0]) writeFileSync(`${outDir}/gold-forged-ar.txt`, ascii(ar[0], ar[0] + 2500))

const ie = allHits('async function ie(').filter(
  i => i > 210500000 && i < 210570000,
)
if (ie[0]) writeFileSync(`${outDir}/gold-forged-ie.txt`, ascii(ie[0], ie[0] + 2000))

const qt = allHits('async function qt(').filter(
  i => i > 210500000 && i < 210570000,
)
console.log('\nqt hits', qt)
if (qt[0]) writeFileSync(`${outDir}/gold-forged-qt.txt`, ascii(qt[0], qt[0] + 2500))

const vn = allHits('function vn(')
console.log('\nvn', vn.slice(0, 6))
for (const i of vn.slice(0, 3)) {
  if (i > 210400000 && i < 210600000) console.log(ascii(i, i + 300))
}

const rn = allHits('function Rn(')
console.log('\nRn', rn.filter(i => i > 210400000 && i < 210600000))
for (const i of rn.filter(i => i > 210400000 && i < 210600000).slice(0, 2)) {
  console.log(ascii(i, i + 400))
}
