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

for (const n of [
  'function R4n(',
  'mCt=',
  'var mCt',
  'F3o(',
  'function F3o',
  'H4n("ccr-seed"',
  'function H4n(',
  'bundle create',
  'empty_repo',
  'c.stash',
  'tYn(',
  'function tYn',
]) {
  const hits = allHits(n).filter(i => i > 215220000 && i < 215280000)
  console.log(n, hits.slice(0, 6))
  for (const i of hits.slice(0, 1)) console.log(ascii(i, i + 180))
}

writeFileSync(base + 'gold-forged-TCt-empty-R4n.txt', ascii(215263400, 215268200))
writeFileSync(base + 'gold-forged-TCt-bundle-tail.txt', ascii(215267200, 215271500))
console.log('--- R4n ---')
const r4 = allHits('function R4n(e=Date.now())')[0]
console.log(r4, ascii(r4, r4 + 280))
console.log('--- mCt near R4n ---')
console.log(ascii(215231800, 215232200))
