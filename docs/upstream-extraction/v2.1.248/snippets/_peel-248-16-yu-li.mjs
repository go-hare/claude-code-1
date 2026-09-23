import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-16-yu-li.txt'
const b = loadSea(EXE_248)
const lines = [
  '# gold-248-16-yu-li',
  `exe=${EXE_248}`,
  `bytes=${b.length}`,
  `when=${new Date().toISOString()}`,
  '',
]

function dumpFn(label, needle, from = 0) {
  const hits = allHits(b, needle)
  lines.push(`## ${label} needle=${JSON.stringify(needle)} hits=${hits.length} first=${hits[0] ?? -1}`)
  const i = hits.find(h => h >= from) ?? hits[0] ?? -1
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return
  }
  const near = lastFnStartGeneric(b, i + 20, 4000)
  const ext = extractFnAt(b, near.i >= 0 ? near.i : i, 4000)
  lines.push(`at=${i} fnStart=${near.i} name=${near.name} len=${ext.len} sha=${ext.sha}`)
  lines.push(ext.body ?? ext.preview ?? 'MISS')
  lines.push('')
}

function dumpWin(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b, i - before, i + after))
  lines.push('')
}

// load() gate: T=F-this.#y>=Yu(ZZ(),F-Zg())
dumpWin('gate-win', 192137355, 0, 220)
dumpFn('Yu(', 'function Yu(')
dumpFn('ZZ(', 'function ZZ()')
dumpFn('Zg(', 'function Zg()')
dumpFn('Li(', 'function Li(')
dumpFn('se(', 'function se(')
dumpFn('Wo(', 'function Wo(')

// also search unique interval constants near fleet
for (const n of [
  'function Yu(e,t)',
  'Yu(ZZ()',
  'function Li(e,t)',
  'Zg=',
]) {
  const hits = allHits(b, n)
  lines.push(`## hits ${JSON.stringify(n)} count=${hits.length} ${hits.slice(0, 8).join(',')}`)
}

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out, 'lines', lines.length)
