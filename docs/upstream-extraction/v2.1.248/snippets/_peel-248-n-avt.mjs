import { writeFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  extractFnAt,
  loadSea,
  asciiSlice,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['# gold-248-n-avt', '']

function dumpFn(name, lo, hi, max = 12) {
  const hits = allHits(buf, name).filter(i => i >= lo && i <= hi)
  lines.push(`## ${name} ${hits.length} ${hits.slice(0, 16).join(',')}`)
  for (const i of hits.slice(0, max)) {
    const ext = extractFnAt(buf, i, 2000)
    lines.push(
      `@${i} ${ext.body && ext.body.length < 600 ? ext.body : asciiSlice(buf, i, i + 220)}`,
    )
  }
  lines.push('')
}

dumpFn('function i7(', 178480000, 178560000)
dumpFn('function Iq(', 178480000, 178560000)
dumpFn('Iq=()=>', 178480000, 178560000)
dumpFn('function Iq()', 178480000, 178560000)

lines.push('## around avt @178495900')
lines.push(asciiSlice(buf, 178495900, 178496400))
lines.push('')

for (const n of ['i7(e,Z)', 'var Z=', 'Z=randomUUID', 'Iq=randomUUID', 'function Iq(){return']) {
  const hits = allHits(buf, n)
  lines.push(`## ${n} ${hits.slice(0, 8).join(',')}`)
  for (const i of hits.slice(0, 3)) {
    lines.push(`@${i} ${asciiSlice(buf, Math.max(0, i - 40), i + 200)}`)
  }
  lines.push('')
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-n-avt.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-n-avt.txt')
