import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  loadSea,
  asciiSlice,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-midconv-clear', '']

for (const n of [
  'cTn()',
  'lTn()',
  'function cTn',
  'function lTn',
  'markMidConvCachePromotionRejected()',
  'host.requestLatches.reset',
]) {
  const hits = allHits(buf, n)
  lines.push(`## ${n} hits=${hits.length}`)
  for (const i of hits.slice(0, 10)) {
    lines.push(`@${i} ${asciiSlice(buf, i - 80, i + 200).replace(/\n/g, ' ')}`)
    lines.push('')
  }
}

// Search clear/compact near midConv latch
const hits = allHits(buf, 'markMidConvCachePromotionRejected')
for (const i of hits) {
  if (i < 178500000 || i > 179000000) continue
  lines.push(`## call-near @${i}`)
  lines.push(asciiSlice(buf, i - 300, i + 100))
  lines.push('')
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-midconv-clear.txt',
  lines.join('\n'),
)
console.log('wrote')
