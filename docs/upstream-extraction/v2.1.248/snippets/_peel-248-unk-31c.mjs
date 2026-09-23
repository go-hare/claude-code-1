/**
 * #31 pass3 — identify Ze in 248 fn() vs 247 Pu(); leftover host for Ze.clear()?
 */
import { writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  loadSea,
  asciiSlice,
  allHits,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = ['# gold-248-unk-31c', `when=${new Date().toISOString()}`, '']

function dump(buf, label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  lines.push(i < 0 ? 'MISS' : asciiSlice(buf, i - before, i + after))
  lines.push('')
}

// 248 fn @198351726 — dump larger preamble to find Ze=/pe=
const fn248 = 198351726
dump(b248, '248 fn preamble', fn248, 4000, 200)

// 247 Pu @216868713
const pu247 = 216868713
dump(b247, '247 Pu preamble', pu247, 4000, 200)

// Ze.clear() hits
const ze248 = allHits(b248, 'Ze.clear()').filter(i => i > 170000000)
const ze247 = allHits(b247, 'Ze.clear()').filter(i => i > 170000000)
lines.push(`Ze.clear() js248=${ze248.length} js247=${ze247.length} ${ze248}`)
for (const i of ze248) dump(b248, '248 Ze.clear', i, 120, 80)

// leftover-shaped names near pe / Ze
for (const n of [
  'let Ze=',
  'Ze=new',
  'Ze.clear',
  ',Ze=',
  'pe=new',
  'let pe=',
  'pe.set(',
  'pe.delete(',
  'pendingPrompts',
  'pendingPermission',
]) {
  const a = allHits(b248, n).filter(i => i > 198300000 && i < 198400000)
  const b = allHits(b247, n).filter(i => i > 216800000 && i < 216950000)
  lines.push(`near-fn ${JSON.stringify(n)} 248=${a} 247=${b}`)
  for (const i of a.slice(0, 3)) dump(b248, `248 near-fn ${n}`, i, 80, 120)
}

// 248 vs 247 setOnConnect delta around requires_action
dump(b248, '248 requires_action block', 198351853, 80, 200)
dump(b247, '247 requires_action block', 216868840, 80, 200)

writeFileSync(`${outDir}/gold-248-unk-31c.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-unk-31c.txt`, 'lines', lines.length)
