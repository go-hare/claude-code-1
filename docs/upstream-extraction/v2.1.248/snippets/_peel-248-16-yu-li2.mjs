import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  sha,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-16-yu-li.txt'
const b = loadSea(EXE_248)
const lines = [
  '# gold-248-16-yu-li2',
  `when=${new Date().toISOString()}`,
  '',
]

function dumpAt(label, i, maxLen = 2500) {
  const near = lastFnStartGeneric(b, i + 8, 8000)
  const ext = extractFnAt(b, near.i >= 0 ? near.i : i, maxLen)
  lines.push(
    `## ${label} @${i} fn=${near.name}@${near.i} len=${ext.len} sha=${ext.sha}`,
  )
  lines.push(ext.body ?? ext.preview ?? 'MISS')
  lines.push('')
}

function dumpWin(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  lines.push(asciiSlice(b, i - before, i + after))
  lines.push('')
}

for (const i of [181247234, 182209647, 204436277]) dumpAt(`Yu(e,t)`, i)
for (const i of [187862390, 203987686]) dumpAt(`Li(e,t)`, i)

// se( near load hrefs @192137355
dumpWin('se-call', 192137300, 80, 80)
const seCall = b.lastIndexOf(Buffer.from('let x=se('), 192137355 + 20)
lines.push(`## last let x=se( before load = ${seCall}`)
if (seCall >= 0) {
  dumpWin('se-call-win', seCall, 20, 160)
  dumpAt('se-near-fleet', seCall)
}

// Wo( near same
const woCall = b.lastIndexOf(Buffer.from('Wo('), 192137355)
lines.push(`## last Wo( before load = ${woCall}`)
if (woCall >= 0) dumpAt('Wo-near-fleet', woCall)

// Yu(ZZ near gate
dumpAt('Yu-near-gate', 192137442)

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out)
