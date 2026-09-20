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

const TCT = 215257791
const TCT_END = TCT + 28000
const base = 'docs/upstream-extraction/v2.1.247/snippets/'

console.log('==== TCt window', TCT, TCT_END, '====')
console.log(ascii(TCT, TCT + 80))

const needles = [
  'await Hu(',
  'Hu(o,',
  'Hu(e,',
  'bHe(o,',
  'bHe(e,',
  'function bHe',
  '}finally{',
  'refs/seed/',
  'update-ref',
  '--no-deref',
  'nQ,rQ',
  'A4n(',
]

for (const needle of needles) {
  const hits = allHits(needle).filter(i => i >= TCT && i < TCT_END)
  console.log('\n====', JSON.stringify(needle), hits.length, hits)
  for (const i of hits.slice(0, 20)) {
    console.log(' @', i)
    console.log(ascii(Math.max(TCT, i - 60), i + 180))
  }
}

const huHits = allHits('await Hu(').filter(i => i >= TCT && i < TCT_END)
const bheHits = allHits('bHe(').filter(i => i >= TCT && i < TCT_END)
const finallyHits = allHits('}finally{').filter(i => i >= TCT && i < TCT_END)

const lines = [
  `TCt@${TCT}`,
  ascii(TCT, TCT + 220),
  '',
  `Hu-count@TCt=${huHits.length}`,
  ...huHits.map(
    (i, n) =>
      `Hu[${n}]@${i}\n${ascii(i, i + 220)}`,
  ),
  '',
  `bHe-count@TCt=${bheHits.length}`,
  ...bheHits.map(
    (i, n) =>
      `bHe[${n}]@${i}\n${ascii(Math.max(TCT, i - 40), i + 160)}`,
  ),
  '',
  `finally-count@TCt=${finallyHits.length}`,
  ...finallyHits.map(
    (i, n) =>
      `finally[${n}]@${i}\n${ascii(i, i + 420)}`,
  ),
]

writeFileSync(base + 'gold-forged-TCt-Hu-calls.txt', lines.join('\n\n'))
console.log('\nwrote gold-forged-TCt-Hu-calls.txt')
