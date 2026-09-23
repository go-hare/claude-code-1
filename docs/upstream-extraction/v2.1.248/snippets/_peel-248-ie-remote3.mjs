/**
 * Peel official Gu / Vu / Hu / w8 / Th for fleet loadRemote.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-ie-remote3',
  `exe=${EXE_248}`,
  `when=${new Date().toISOString()}`,
  '',
]

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  lines.push(`len=${ext.len ?? ''} sha=${ext.sha ?? ''}`)
  lines.push(ext.body ?? JSON.stringify(ext))
  lines.push('')
}

dumpAround('Gu-192115692', 192115692, 0, 1400)
dumpAround('Vu-192116575', 192116575, 0, 700)
dumpAround('Hu-192115650', 192115620, 0, 200)
dumpAround('hh-near-Gu', 192115200, 0, 500)
dumpFn('Hu', 192115650)
dumpFn('Gu', 192115692)
dumpFn('Vu', 192116575)
dumpFn('WKe', 179877053)
dumpFn('Nu', 192115620)

const w8 = allHits(buf, 'function w8(')
lines.push(`## function w8( hits=${w8.length} @${w8.slice(0, 8)}`)
for (const i of w8.slice(0, 3)) dumpFn('w8', i, 2000)

const Th = allHits(buf, 'Th=30000')
lines.push(`## Th=30000 @${Th}`)
dumpAround('Th-window', Th[0] ?? -1, 80, 80)

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-ie-remote3.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-ie-remote3.txt')
