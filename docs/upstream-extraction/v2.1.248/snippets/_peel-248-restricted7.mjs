/**
 * Pass 7 — enablesCodeExecution assignments + leftover-mapping needles.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  asciiSlice,
  loadSea,
  allHits,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-restricted-enables',
  `bytes=${buf.length}`,
  `when=${new Date().toISOString()}`,
  '',
]

function dumpHits(label, needle, around = 140, cap = 20) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(buf, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

dumpHits('enablesCodeExecution', 'enablesCodeExecution')
dumpHits('enablesCodeExecution:!0', 'enablesCodeExecution:!0')
dumpHits('enablesCodeExecution:true', 'enablesCodeExecution:true')
dumpHits('enablesCodeExecution:!1', 'enablesCodeExecution:!1')

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-restricted-enables.txt',
  lines.join('\n'),
)
console.log('WROTE enables chars=', lines.join('\n').length)
