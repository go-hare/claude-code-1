import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-Gqe-helpers', '']

// z body refs: L, kur, Dgn, N, Yl
// Find function L( near Gqe by looking at assignments before z
const zAt = 179527519
lines.push('## lookback before z @179527519')
lines.push(asciiSlice(buf, zAt - 8000, zAt + 50))
lines.push('')

for (const n of [
  'async function L(',
  'function L(',
  'function kur(',
  'async function Dgn(',
  'function Dgn(',
  'async function N(',
  'function Yl(',
  'function Mgn(',
  'async function Ogn(',
  'function Ogn(',
]) {
  const hits = allHits(buf, n).filter(i => i > 179500000 && i < 179560000)
  lines.push(`## ${n} in z-window hits=${hits.length}`)
  for (const i of hits.slice(0, 3)) {
    const ext = extractFnAt(buf, i, 5000)
    if (ext.body) {
      lines.push(`@${i} sha=${ext.sha} len=${ext.len}`)
      lines.push(
        ext.body.length > 2800 ? ext.body.slice(0, 2800) + '…' : ext.body,
      )
    }
    lines.push('')
  }
}

// All Gqe( call sites
const calls = allHits(buf, 'Gqe(')
lines.push(`## all Gqe( hits=${calls.length}`)
for (const i of calls.slice(0, 30)) {
  lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 80), i + 100)}`)
}

writeFileSync(new URL('./gold-248-Gqe-helpers.txt', import.meta.url), lines.join('\n'))
console.log('wrote', lines.length)
