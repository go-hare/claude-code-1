import { writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  loadSea,
  asciiSlice,
  allHits,
  extractFnAt,
} from './_peel-248-na-helpers.mjs'

const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = ['# gold-248-24-ste-xde', `when=${new Date().toISOString()}`, '']

function dumpFn(label, i, maxLen = 4000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(b248, i, maxLen)
  if (ext.body) {
    lines.push(
      `len=${ext.len} sha=${ext.sha} exact247=${b247.indexOf(Buffer.from(ext.body))}`,
    )
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
}

for (const n of ['function Ste(', 'function XDe(', 'function gC(', 'we=Ste(']) {
  const h = allHits(b248, n)
  lines.push(`## needle ${n} 248=${h.length} 247=${allHits(b247, n).length} @${h.slice(0, 8)}`)
  for (const i of h.slice(0, 3)) {
    if (n.startsWith('function ')) dumpFn(n, i, 3500)
    else lines.push(asciiSlice(b248, i - 120, i + 200), '')
  }
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-24-ste-xde.txt',
  lines.join('\n'),
)
console.log('ok', lines.length)
