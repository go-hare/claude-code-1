import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const exe =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const b248 = readFileSync(exe)

function asciiSlice(buf, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(buf.length, end)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

const needle = Buffer.from('prStatuses')
const hits = []
let from = 0
while (from < b248.length) {
  const i = b248.indexOf(needle, from)
  if (i < 0) break
  hits.push(i)
  from = i + needle.length
}

const lines = [
  '# gold-248-16-prstatuses-uses',
  `exe=${exe}`,
  `hits=${hits.length}`,
  `offsets=${hits.join(',')}`,
  '',
]

for (const i of hits) {
  lines.push(`## prStatuses @${i}`)
  lines.push(asciiSlice(b248, i - 160, i + 280))
  lines.push('')
}

const extras = [
  'fetchPrStatusBatch',
  'function V$n',
  'this.#E(',
  '.prStatuses.get',
  '.prStatuses.set',
  'Cannot destructure property',
]
for (const n of extras) {
  const buf = Buffer.from(n)
  const idx = []
  let p = 0
  while (p < b248.length) {
    const i = b248.indexOf(buf, p)
    if (i < 0) break
    idx.push(i)
    p = i + buf.length
    if (idx.length >= 12) break
  }
  lines.push(`## needle ${JSON.stringify(n)} hits=${idx.length}`)
  for (const i of idx) {
    lines.push(`### @${i}`)
    lines.push(asciiSlice(b248, i - 120, i + 320))
    lines.push('')
  }
}

writeFileSync(`${outDir}/gold-248-16-prstatuses-uses.txt`, lines.join('\n'))
console.log('WROTE', hits.length, 'prStatuses hits')
