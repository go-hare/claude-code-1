import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  extractFnAt,
  allHits,
} from './_peel-248-na-helpers.mjs'

const b = loadSea(EXE_248)
const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-16-why.txt'
const lines = ['# gold-248-16-why', `when=${new Date().toISOString()}`, '']

function dumpFn(label, i, max = 4000) {
  const ext = extractFnAt(b, i, max)
  lines.push(`## ${label} @${i} len=${ext.len} sha=${ext.sha}`)
  lines.push(ext.body ?? ext.preview ?? 'MISS')
  lines.push('')
}

function catalog(needle, max = 20) {
  const rows = []
  const n = Buffer.from(needle)
  let i = 0
  while (i < b.length && rows.length < max) {
    const k = b.indexOf(n, i)
    if (k < 0) break
    rows.push({ i: k, p: asciiSlice(b, k, k + 140) })
    i = k + n.length
  }
  return rows
}

// aF near Oo @192124798
lines.push('## aF near Oo')
lines.push(asciiSlice(b, 192120000, 192125200))
lines.push('')

for (const needle of [
  'aF=',
  'var aF',
  'aF={name',
  'name:"pr"',
  'name:"code-review"',
  'template===aF',
]) {
  const hits = catalog(needle, 8)
  lines.push(`## hits ${needle} n=${hits.length}`)
  for (const h of hits) lines.push(`@${h.i} ${h.p}`)
  lines.push('')
}

// Cf / rP near Oo
for (const needle of ['function Cf(', 'function rP(', 'function tst(', 'function iXe(', 'function wJt(', 'function kJt(', 'function TJt(', 'function KX(', 'const aXe=', 'var aXe=', 'aXe=20', 'const vJt=', 'var vJt=']) {
  const hits = catalog(needle, 12)
  lines.push(`## hits ${needle} n=${hits.length}`)
  for (const h of hits.slice(0, 8)) lines.push(`@${h.i} ${h.p}`)
  lines.push('')
}

// KC= near fleet 19212
const kcNear = b.lastIndexOf(Buffer.from('KC=/'), 192124739)
lines.push(`## last KC=/ before Wo ${kcNear}`)
if (kcNear >= 0) lines.push(asciiSlice(b, kcNear - 40, kcNear + 80))
const kcVar = catalog('KC=/', 15)
lines.push('## all KC=/')
for (const h of kcVar) lines.push(`@${h.i} ${h.p}`)

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out, lines.length)
