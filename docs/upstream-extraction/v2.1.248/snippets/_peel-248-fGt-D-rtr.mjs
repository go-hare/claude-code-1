/**
 * Peel official D/rtr pin gate (chunk-4qdmbxwt) used by fGt retain/primer paths.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  loadSea,
  asciiSlice,
  sha,
  extractFnAt,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const out =
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-fGt-D-rtr.txt'
const lines = ['# gold-248-fGt-D-rtr', '']

const chunkStart = 178167129 - 200
lines.push('## full chunk around D/rtr @178167129')
lines.push(asciiSlice(buf, 178166950, 178167250))
lines.push('')
lines.push(`sha_body=${sha('var e;function D(){return e===!0}function rtr(t){let n=t===!0;if(e===void 0)return e=n,"pinned";return e===n?"unchanged":"conflict"}')}`)

lines.push('')
lines.push('## rtr( call sites')
for (const i of allHits(buf, 'rtr(').slice(0, 40)) {
  lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 80), i + 100).replace(/\n/g, ' ')}`)
}

lines.push('')
lines.push('## import{rtr} / import{D,rtr} / import{rtr,')
for (const n of [
  'import{rtr}',
  'import{rtr,',
  'import{D,rtr}',
  'import{D,rtr,',
  ',rtr}',
  ',rtr,',
  '{rtr}',
]) {
  const hits = allHits(buf, n)
  lines.push(`${JSON.stringify(n)} hits=${hits.length}`)
  for (const i of hits.slice(0, 15)) {
    lines.push(`@${i} ${asciiSlice(buf, i, i + 120).replace(/\n/g, ' ')}`)
  }
}

lines.push('')
lines.push('## chunk-4qdmbxwt string refs')
for (const i of allHits(buf, 'chunk-4qdmbxwt')) {
  lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 60), i + 80).replace(/\n/g, ' ')}`)
}

// Peel rtr fully
lines.push('')
lines.push('## extractFn D and rtr')
lines.push(JSON.stringify(extractFnAt(buf, 178167129, 200)))
{
  const hits = allHits(buf, 'function rtr(t){')
  lines.push(`function rtr(t){ → ${hits.join(',')}`)
  for (const i of hits.slice(0, 3)) {
    lines.push(JSON.stringify(extractFnAt(buf, i, 400)))
  }
}

// Who pins true — search rtr(!0) rtr(true) rtr(!1)
lines.push('')
lines.push('## rtr literal calls')
for (const n of ['rtr(!0)', 'rtr(!1)', 'rtr(true)', 'rtr(false)', 'rtr(e)', 'rtr(t)']) {
  const hits = allHits(buf, n)
  lines.push(`${n} → ${hits.join(',') || 'NONE'}`)
  for (const i of hits.slice(0, 8)) {
    lines.push(`@${i} ${asciiSlice(buf, i - 100, i + 80).replace(/\n/g, ' ')}`)
  }
}

writeFileSync(out, lines.join('\n'))
console.log('wrote', out)
