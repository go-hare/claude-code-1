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
  'async function Or(',
  'function Or(',
  'async function Ne(',
  'function rn(',
  'async function qi(',
  'async function nt(',
  'function T(S,',
]) {
  const hits = allHits(n).filter(i => i > 210500000 && i < 210750000)
  console.log(n, hits.slice(0, 6))
  for (const i of hits.slice(0, 1)) console.log(ascii(i, i + 400))
}

// hash-object Qi in _465 after hs
const qi465 = allHits('async function Qi(').filter(
  i => i > 210720000 && i < 210745000,
)
console.log('Qi in _465', qi465)
for (const i of qi465) console.log(ascii(i, i + 500))

const to = allHits('async function to(e,n,t)')
console.log('to', to)
for (const i of to.filter(i => i > 210540000 && i < 210560000)) {
  writeFileSync(`${outDir}/gold-forged-X4n-to.txt`, ascii(i, i + 14000))
}

const or = allHits('async function Or(').filter(
  i => i > 210500000 && i < 210545000,
)
if (or[0]) writeFileSync(`${outDir}/gold-forged-Or.txt`, ascii(or[0], or[0] + 4000))

const ne = allHits('async function Ne(').filter(
  i => i > 210700000 && i < 210745000,
)
if (ne[0]) {
  writeFileSync(`${outDir}/gold-forged-Ne.txt`, ascii(ne[0], ne[0] + 2500))
  console.log('Ne', ascii(ne[0], ne[0] + 400))
}
