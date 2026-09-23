/**
 * Third peel: H1t, mcr, uae callers, parkedJobId, Nw.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  allHits,
  extractFnAt,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const buf = loadSea(EXE_248)
const lines = [`when=${new Date().toISOString()}`]

function dumpWin(label, off, before = 200, after = 600) {
  lines.push('')
  lines.push(`## ${label} @${off}`)
  lines.push(asciiSlice(buf, off - before, off + after))
}

for (const n of [
  'var H1t=',
  'H1t=',
  'var mcr=',
  'mcr=',
  'function uae(',
  'uae(',
  'parkedJobId',
  'function Nw(',
  '"dead-epoch"',
  'dead-epoch row',
]) {
  const hits = allHits(buf, n)
  lines.push('')
  lines.push(`## hits ${JSON.stringify(n)} count=${hits.length} ${hits.slice(0, 10).join(',')}`)
  for (const h of hits.slice(0, 6)) {
    lines.push(`-- @${h}`)
    lines.push(asciiSlice(buf, h - 100, h + 280))
  }
}

// extract Nw near Di @182998174
const nwHits = allHits(buf, 'function Nw(')
for (const h of nwHits) {
  if (h > 182990000 && h < 183010000) {
    const ext = extractFnAt(buf, h, 1500)
    lines.push('')
    lines.push(`## Nw-near-Di @${h}`)
    if (ext.body) lines.push(ext.body)
    else lines.push(asciiSlice(buf, h, h + 400))
  }
}

writeFileSync(`${outDir}/gold-248-17-19c.txt`, lines.join('\n'))
console.log('wrote', lines.length)
