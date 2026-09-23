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
const lines = ['# gold-248-n-align', '']

function dumpFn(name, lo = 0, hi = buf.length, max = 8) {
  const hits = allHits(buf, name).filter(i => i >= lo && i <= hi)
  lines.push(`## ${name} hits=${hits.length} ${hits.slice(0, 12).join(',')}`)
  for (const i of hits.slice(0, max)) {
    const ext = extractFnAt(buf, i, 2500)
    if (ext.body && ext.body.length < 800) {
      lines.push(`@${i} sha=${ext.sha} ${ext.body}`)
    } else if (ext.body) {
      lines.push(`@${i} sha=${ext.sha} len=${ext.len} ${ext.body.slice(0, 280)}`)
    } else {
      lines.push(`@${i} ${asciiSlice(buf, i, i + 200)}`)
    }
  }
  lines.push('')
}

function dumpAround(label, i, before = 80, after = 240) {
  lines.push(`## ${label} @${i}`)
  lines.push(asciiSlice(buf, Math.max(0, i - before), i + after))
  lines.push('')
}

dumpFn('function eo(')
dumpFn('function avt(')
dumpFn('function Iq(')
dumpFn('function Zt(')
dumpFn('markScrollActivity')
dumpFn('scrollDraining()')
dumpFn('waitForScrollIdle')

for (const n of ['var Zt=', 'Zt=', 'const Zt=', 'let Zt=']) {
  const hits = allHits(buf, n).filter(i => i > 178500000 && i < 178560000)
  lines.push(`## ${n} near-host ${hits.join(',')}`)
  for (const i of hits.slice(0, 6)) {
    lines.push(`@${i} ${asciiSlice(buf, i, i + 80)}`)
  }
  lines.push('')
}

dumpAround('ye.mainAgentId', 178529589, 0, 200)
dumpAround('Se.scroll', 178527129, 0, 900)
dumpAround('un.avt', 178548313, 0, 280)

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-n-align.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-n-align.txt')
