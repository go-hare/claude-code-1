import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  extractFnAt,
  loadSea,
  asciiSlice,
  sha,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-n-root2', '']

function hitsNear(needle, lo, hi) {
  return allHits(buf, needle).filter(i => i >= lo && i <= hi)
}

for (const n of [
  'function C(',
  'function v(',
  'var v=',
  'let v=',
  'host:Xi(',
  'new Ie',
  'new Zt',
  'launchOptions:new',
  'function jn(',
  'function $e(',
  'function X(',
  'function k4(',
  'function eo(',
  'function Li(',
  '?.session??',
]) {
  const hits = allHits(buf, n)
  const near = hits.filter(i => i > 178500000 && i < 178560000)
  lines.push(`## ${n} total=${hits.length} near=${near.length} ${near.slice(0, 8).join(',')}`)
  for (const i of near.slice(0, 3)) {
    if (n.startsWith('function ')) {
      const ext = extractFnAt(buf, i, 2000)
      lines.push(`@${i} ${ext.body ?? JSON.stringify(ext)}`)
    } else {
      lines.push(`@${i} ${asciiSlice(buf, i, i + 280)}`)
    }
  }
  lines.push('')
}

// n() @178548576 callers / v mint
lines.push('## around n() @178548500')
lines.push(asciiSlice(buf, 178548400, 178549200))
lines.push('')

// before class re @178514241 — X() L() Ji
lines.push('## before class re @178513800')
lines.push(asciiSlice(buf, 178513700, 178514260))
lines.push('')

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-n-root2.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-n-root2.txt')
