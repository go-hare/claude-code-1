import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  loadSea,
  asciiSlice,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-cut-extras', '']

for (const n of [
  'markMidConvCachePromotionRejected',
  'midConvCachePromotionRejected',
  'FORCE_SESSION_PERSISTENCE',
  'sessionPersistenceDisabled()',
  'function qC()',
  'function Rkn(',
  'requestLatches.reset()',
  '.requestLatches.reset(',
]) {
  const hits = allHits(buf, n)
  lines.push(`## ${n} hits=${hits.length}`)
  for (const i of hits.slice(0, 8)) {
    if (typeof i === 'number' && (i < 178400000 || i > 180000000)) {
      // still show a few
      if (hits.indexOf(i) > 2) continue
    }
    lines.push(`@${i} ${asciiSlice(buf, i - 60, i + 220).replace(/\n/g, ' ')}`)
    lines.push('')
  }
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-cut-extras.txt',
  lines.join('\n'),
)
console.log('wrote')
