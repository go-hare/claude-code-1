import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiSlice(buf, start, end) {
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

function allHits(buf, needle) {
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

const needles = [
  'Wr as ',
  ' as Wr',
  'plugins.map(Wr',
  'plugins.map((',
  'Wr(F)',
  'Wr(S)',
  'Wr(H)',
  'Wr(p)',
  'Vr(T)',
  'Vr(v)',
  'Vr(P)',
]

for (const n of needles) {
  const hits = allHits(b247, n)
  console.log(hits.length, JSON.stringify(n), hits.slice(0, 8))
}

// search Wr( in the settings module window 207950000-208050000
const start = 207950000
const end = 208100000
const win = asciiSlice(b247, start, end)
let idx = 0
let n = 0
while (n < 20) {
  const j = win.indexOf('Wr(', idx)
  if (j < 0) break
  console.log('Wr( in module', start + j, win.slice(j - 40, j + 60).replace(/\n/g, ' '))
  idx = j + 3
  n++
}

// export list containing re as
const exp = allHits(b247, 're as ')
console.log('re as hits', exp.length, exp.slice(0, 10))
for (const i of exp.slice(0, 6)) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-25-escape-re-as-${i}.txt`,
    `# @${i}\n\n${asciiSlice(b247, i - 200, i + 250)}\n`,
  )
}
