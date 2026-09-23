/**
 * Peel leftover-hosted official Ie wrappers (clientType, sdk, bypass, scheduled, persistence, initJson).
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  extractFnAt,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-ie-wrappers2',
  `when=${new Date().toISOString()}`,
  '',
]

for (const n of [
  'function a7e(',
  'function $En(',
  'function _de(',
  'function FEn(',
  'function H4(',
  'function Tkn(',
  'function b7e(',
  'function V$(',
  'function qC(',
  'function Rkn(',
  'function xvt(',
  'function Dkn(',
  'function f7e(',
  'function De(',
  'function vu(',
  'function AEn(',
]) {
  const hits = allHits(buf, n)
  lines.push(`## ${n} hits=${hits.length}`)
  for (const i of hits.slice(0, 4)) {
    const ext = extractFnAt(buf, i, 500)
    lines.push(`@${i} sha=${ext.sha ?? ''} ${ext.body ?? JSON.stringify(ext)}`)
  }
  lines.push('')
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-ie-wrappers2.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-ie-wrappers2.txt')
