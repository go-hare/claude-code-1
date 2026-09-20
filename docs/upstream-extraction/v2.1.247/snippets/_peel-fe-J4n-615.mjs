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
// fe as aGb — find function fe( near 212749
for (const i of allHits('function fe(').filter(i => i > 212740000 && i < 212760000)) {
  console.log('fe', i)
  console.log(ascii(i, i + 800))
  writeFileSync(base + 'gold-forged-J4n-fe.txt', ascii(i, i + 1200))
}

console.log('\n==== wZb yZb ====')
for (const n of [' as wZb', ' as yZb', 'wZb as oe', 'function W(){return']) {
  console.log(n, allHits(n).slice(0, 4))
}

const w = buf.indexOf(Buffer.from(' as wZb'))
console.log('wZb export', ascii(w - 100, w + 15))
