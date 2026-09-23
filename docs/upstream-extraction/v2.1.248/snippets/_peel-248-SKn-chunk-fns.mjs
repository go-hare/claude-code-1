import { writeFileSync } from 'fs'
import {
  EXE_248,
  asciiSlice,
  extractFnAt,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const needle = Buffer.from(
  'import{l}from"B:/~BUN/root/chunk-mw2w72bj.js";import{Pc,n}from',
)
const chunkMark = buf.indexOf(needle, 179500000)
const skn = 179523748
const lines = [`# gold-248-SKn-chunk-fns`, `chunkMark=${chunkMark}`, '']
const chunk = asciiSlice(buf, chunkMark, skn + 8000)
const re = /(?:async )?function ([A-Za-z_$][\w$]*)\(/g
let m
const seen = new Map()
while ((m = re.exec(chunk))) {
  const name = m[1]
  if (!seen.has(name)) seen.set(name, chunkMark + m.index)
}
lines.push('## roster')
for (const [n, a] of seen) lines.push(`${n}@${a}`)
lines.push('')

for (const name of ['k', 'Npn', 'b', 'L', 'j', 'v', 'T', 'O', 'U', 'Tur', 'wKn']) {
  const a = seen.get(name)
  if (a === undefined) {
    lines.push(`## ${name} MISSING`)
    continue
  }
  const ext = extractFnAt(buf, a, 4000)
  lines.push(`## ${name} @${a} len=${ext.len} sha=${ext.sha}`)
  lines.push(ext.body ?? asciiSlice(buf, a, a + 400))
  lines.push('')
}

// also dump var P,E and imports
lines.push('## preamble')
lines.push(asciiSlice(buf, chunkMark, chunkMark + 1200))

writeFileSync(new URL('./gold-248-SKn-chunk-fns.txt', import.meta.url), lines.join('\n'))
console.log('wrote', [...seen.keys()].join(','))
