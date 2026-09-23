// densable 2.1.248 #48 — find apply callers of eGn / unmappedOwnerUid / Set M
import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const bL = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-248-linux/package/claude',
)

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

function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (i < buf.length) {
    const k = buf.indexOf(n, i)
    if (k < 0) break
    hits.push(k)
    i = k + n.length
  }
  return hits
}

const lines = ['# gold-248-48-linux3', '']

function dumpHits(label, needle, max = 10) {
  const hits = allHits(bL, needle)
  lines.push(`## ${label} hits=${hits.length}`)
  for (const h of hits.slice(0, max)) {
    lines.push(`- @${h}`)
    lines.push(asciiSlice(bL, h - 180, h + 320))
    lines.push('')
  }
}

const needles = [
  'eGn()',
  'unmappedOwnerUid',
  'uidCollapses',
  'rootUidAmbiguous',
  '/var/roothome',
  '/mnt/wslg',
  'tGn()',
  'GWe()',
  'await tGn',
  'await GWe',
]

for (const n of needles) dumpHits(JSON.stringify(n), n)

writeFileSync(`${outDir}/gold-248-48-linux3.txt`, lines.join('\n'))
console.log('WROTE linux3', lines.length)
