import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

const needle = Buffer.from(
  "The name '${e}' is reserved for official Anthropic marketplaces and its registered source is malformed.",
)
// template might be split
const hits = []
const n = Buffer.from('registered source is malformed')
let from = 0
while (hits.length < 6) {
  const i = buf.indexOf(n, from)
  if (i < 0) break
  hits.push(i)
  from = i + 10
}
console.log('malformed', hits)
for (const i of hits) {
  console.log(asciiWindow(buf, i - 200, i + 80))
}

const rme = 214551662
const head = asciiWindow(buf, rme - 25000, rme)
const qfeImp = [...head.matchAll(/as Qfe[,}]/g)]
console.log(
  'as Qfe',
  qfeImp.map((m) => head.slice(Math.max(0, m.index - 80), m.index + 30)),
)

// Only repositories from
const only = buf.indexOf(
  Buffer.from("Only repositories from 'github.com/"),
  214000000,
)
console.log('only-repos', only)
if (only > 0) {
  writeFileSync(
    'docs/upstream-extraction/v2.1.247/snippets/gold-dig-Qfe-near.txt',
    asciiWindow(buf, only - 800, only + 600),
  )
  console.log(asciiWindow(buf, only - 400, only + 400))
}
