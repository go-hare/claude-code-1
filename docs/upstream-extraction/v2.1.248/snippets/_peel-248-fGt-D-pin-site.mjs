/**
 * Peel hover_rest / rtr pin site — what GB/env actually drives D().
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  loadSea,
  asciiSlice,
  extractFnAt,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const out =
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-fGt-D-pin-site.txt'
const lines = ['# gold-248-fGt-D-pin-site', '']

lines.push('## qSn / HOVER_REST / rtr window @187619200')
lines.push(asciiSlice(buf, 187619200, 187620400))
lines.push('')

for (const n of [
  'function qSn(',
  'tengu_hover_rest',
  'CLAUDE_CODE_HOVER_REST',
  'HOVER_REST',
]) {
  const hits = allHits(buf, n)
  lines.push(`## ${n} hits=${hits.length}`)
  for (const i of hits.slice(0, 6)) {
    lines.push(`@${i}`)
    lines.push(asciiSlice(buf, i, i + 350).replace(/\n/g, ' '))
    lines.push('')
  }
}

// Also check: does anything else assign to the pin via rtr?
lines.push('## all rtr( with wider context')
for (const i of allHits(buf, 'rtr(')) {
  lines.push(`@${i}`)
  lines.push(asciiSlice(buf, Math.max(0, i - 250), i + 200))
  lines.push('')
}

// settingsPrime string
lines.push('## settingsPrime')
for (const i of allHits(buf, 'settingsPrime')) {
  lines.push(`@${i} ${asciiSlice(buf, i - 100, i + 200).replace(/\n/g, ' ')}`)
}

writeFileSync(out, lines.join('\n'))
console.log('wrote', out)
