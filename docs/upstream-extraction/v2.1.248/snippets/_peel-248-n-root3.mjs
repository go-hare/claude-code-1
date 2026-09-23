import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  extractFnAt,
  loadSea,
  asciiSlice,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-n-root3', '']
for (const n of [
  'function sn(',
  'function yGt(',
  'function un(',
  'function avt(',
  'function Iq(',
  'function dn(',
  'function ln(',
  'function Xi(',
]) {
  const near = allHits(buf, n).filter(i => i > 178540000 && i < 178555000)
  lines.push(`## ${n} near=${near.length} ${near.join(',')}`)
  for (const i of near.slice(0, 3)) {
    const ext = extractFnAt(buf, i, 4000)
    lines.push(`@${i} sha=${ext.sha ?? ''} ${ext.body ?? JSON.stringify(ext)}`)
  }
  lines.push('')
}
lines.push('## win @178547800')
lines.push(asciiSlice(buf, 178547800, 178548580))
writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-n-root3.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-n-root3.txt')
