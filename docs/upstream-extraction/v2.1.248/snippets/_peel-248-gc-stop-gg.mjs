/**
 * Peel official gg stop/archive dispatch around fleet_view_stop_job.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-gc-stop-gg',
  `when=${new Date().toISOString()}`,
  '',
]

function dump(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

dump('fleet_view_stop_job-192191979', 192191979, 400, 700)
dump('Lr-192191245', 192191245, 80, 250)

for (const n of [
  'backend==="remote"',
  'backend==="remote"&&',
  'state.backend==="remote"',
  'stopRemote',
]) {
  const hits = allHits(buf, n).filter(i => i > 192180000 && i < 192280000)
  lines.push(`## ${JSON.stringify(n)} in gg window hits=${hits.length} ${hits.join(',')}`)
  for (const i of hits.slice(0, 8)) {
    dump(`gg-${n}`, i, 180, 220)
  }
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-gc-stop-gg.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-gc-stop-gg.txt')
