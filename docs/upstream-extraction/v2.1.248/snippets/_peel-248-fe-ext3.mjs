import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  extractFnAt,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-fe-ext3', '']
for (const n of [
  'function o3t(',
  'function Ade(',
  'function _m(',
  'function D4(',
  'function R7e(',
]) {
  const hits = allHits(buf, n)
  lines.push(`## ${n} hits=${hits.length}`)
  for (const i of hits.slice(0, 3)) {
    const ext = extractFnAt(buf, i, 350)
    lines.push(`@${i} sha=${ext.sha ?? ''} ${ext.body ?? JSON.stringify(ext)}`)
  }
  lines.push('')
}
writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-fe-ext3.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-fe-ext3.txt')
