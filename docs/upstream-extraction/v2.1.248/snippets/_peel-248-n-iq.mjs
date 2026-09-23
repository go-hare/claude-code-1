import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  extractFnAt,
  loadSea,
  asciiSlice,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-n-iq', '']
lines.push('## window 178494800-178496200')
lines.push(asciiSlice(buf, 178494800, 178496200))
lines.push('')
lines.push('## Iq( hits near host')
for (const i of allHits(buf, 'Iq()').filter(x => x > 178490000 && x < 178550000)) {
  lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 60), i + 80)}`)
}
lines.push('')
for (const n of ['function Iq', 'function Cn(', 'randomUUID', 'crypto.randomUUID']) {
  const hits = allHits(buf, n).filter(i => i > 178490000 && i < 178550000)
  lines.push(`## ${n} ${hits.join(',')}`)
  for (const i of hits.slice(0, 4)) {
    if (n.startsWith('function ')) {
      const ext = extractFnAt(buf, i, 800)
      lines.push(`@${i} ${ext.body ?? asciiSlice(buf, i, i + 160)}`)
    } else {
      lines.push(`@${i} ${asciiSlice(buf, i, i + 160)}`)
    }
  }
  lines.push('')
}
writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-n-iq.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-n-iq.txt')
