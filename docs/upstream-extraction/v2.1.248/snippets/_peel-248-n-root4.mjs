import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  extractFnAt,
  loadSea,
  asciiSlice,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-n-root4', '']
for (const n of ['yGt(', 'function yGt', 'yGt=', 'class Ke{', 'class Ne{', 'class Be{', 'class Ue{']) {
  const hits = allHits(buf, n).filter(i => i > 178500000 && i < 178560000)
  lines.push(`## ${n} ${hits.join(',')}`)
  for (const i of hits.slice(0, 2)) {
    if (n.startsWith('class ') || n.startsWith('function ')) {
      const ext = extractFnAt(buf, i, 4000)
      lines.push(`@${i} ${ext.body ?? asciiSlice(buf, i, i + 400)}`)
    } else {
      lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 80), i + 400)}`)
    }
  }
  lines.push('')
}
writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-n-root4.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-n-root4.txt')
