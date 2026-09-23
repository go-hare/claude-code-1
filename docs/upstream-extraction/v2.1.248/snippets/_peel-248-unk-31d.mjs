/**
 * #31 pass4 — 247 twin of pe/Ze; leftover host absent?
 */
import { writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  loadSea,
  asciiSlice,
  allHits,
} from './_peel-248-na-helpers.mjs'

const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-unk-31d.txt'
const lines = ['# gold-248-unk-31d', `when=${new Date().toISOString()}`, '']

function dump(buf, label, i, b, a) {
  lines.push(`## ${label} @${i}`)
  lines.push(i < 0 ? 'MISS' : asciiSlice(buf, i - b, i + a))
  lines.push('')
}

// 247 Ze.clear / getPendingPrompts
for (const n of ['Ze.clear()', '=new Set;function ot(', '=new Map,Ze=new Set', 'getPendingPrompts', 'Local-only retract']) {
  const a = allHits(b248, n).filter(i => i > 170000000)
  const b = allHits(b247, n).filter(i => i > 170000000)
  lines.push(`${JSON.stringify(n)} js248=${a} js247=${b}`)
  for (const i of b.slice(0, 3)) dump(b247, `247 ${n}`, i, 100, 200)
  for (const i of a.slice(0, 3)) dump(b248, `248 ${n}`, i, 80, 160)
}

// 247 equivalent of pe=new Map, Ze=new Set near Pu @216868713
dump(b247, '247 before Pu 10k', 216868713, 9000, 80)

// leftover-shaped strings
for (const n of [
  'Local-only retract of a declined dialog',
  'declined dialog forward',
  'getPendingPrompts',
  'pending_actions',
]) {
  lines.push(
    `all ${JSON.stringify(n)} 248=${allHits(b248, n).length} 247=${allHits(b247, n).length}`,
  )
}

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out, 'lines', lines.length)
