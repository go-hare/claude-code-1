/**
 * #34 pass 2 — extract 247 Fr-equivalent wrapper vs 248 Fr; confirm
 * paddingLeft:1 drop is the unique warnings-column delta.
 */
import { existsSync, writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)

const lines = ['# gold-248-34-column2', '']

function dumpAround(buf, label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(buf, label, i, maxLen = 12000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

// 247 warnings wrapper (the hit that 248 lost)
const wrap247 = b247.indexOf(
  Buffer.from('flexDirection:"column",paddingLeft:1,children:[At.warnings.map'),
)
dumpAround(b247, '247 warnings-wrap exact', wrap247, 80, 500)

const wrap248old = b248.indexOf(
  Buffer.from('flexDirection:"column",paddingLeft:1,children:[qt.warnings.map'),
)
lines.push(`## 248 still-has-247-wrap @${wrap248old}`)
lines.push('')

const wrap248new = b248.indexOf(
  Buffer.from('flexDirection:"column",children:[qt.warnings.map'),
)
dumpAround(b248, '248 warnings-wrap no-pad', wrap248new, 80, 500)

// 247 Fr-like fn
const ctx247 = b247.indexOf(Buffer.from('mcpNeedsAuthCount:'))
dumpAround(b247, '247 mcpNeedsAuthCount ctx', ctx247, 200, 900)
if (ctx247 > 0) {
  const fn = lastFnStartGeneric(b247, ctx247, 15000)
  lines.push(`## 247 fn before mcpNeedsAuthCount ${JSON.stringify(fn)}`)
  if (fn.i >= 0) dumpFn(b247, '247 Fr-equiv', fn.i, 20000)
}

// 247 Je (Gp equivalent)
const je = lastFnStartGeneric(
  b247,
  b247.indexOf(Buffer.from('id:"mcp-needs-auth"')),
  40000,
)
lines.push(`## 247 last generic before Uf ${JSON.stringify(je)}`)

const jeHits = allHits(b247, 'function Je(')
lines.push(`## 247 function Je( hits=${jeHits.length}`)
for (const i of jeHits.slice(0, 8)) {
  const win = asciiSlice(b247, i, i + 200)
  if (win.includes('status') || win.includes('width:2') || win.includes('Qe')) {
    lines.push(`- @${i} ${win}`)
  }
}
lines.push('')

const jeBody = b247.indexOf(
  Buffer.from('function Je(m){let l=g('),
)
dumpFn(b247, '247 function Je(m) react-cache', jeBody, 2000)

const je2 = b247.indexOf(Buffer.from('function Je({status'))
dumpFn(b247, '247 function Je({status', je2, 2000)

// search 247 for width:2 flexShrink:0 Qe status (Gp icon col)
const icon = b247.indexOf(Buffer.from('width:2,flexShrink:0,children:'))
dumpAround(b247, '247 width:2 icon first', icon, 120, 400)

const icon248 = allHits(b248, 'width:2,flexShrink:0,children:e(Qe,{status:')
lines.push(`## 248 Gp-icon-pattern hits=${icon248.length}`)
for (const i of icon248) lines.push(`- @${i} ${asciiSlice(b248, i - 80, i + 120)}`)
lines.push('')

const icon247 = allHits(b247, 'width:2,flexShrink:0,children:')
lines.push(`## 247 width:2,flexShrink:0 hits=${icon247.length}`)
for (const i of icon247.slice(0, 8)) {
  const win = asciiSlice(b247, i - 100, i + 160)
  if (win.includes('status') || win.includes('warning')) {
    lines.push(`- @${i} ${win}`)
  }
}
lines.push('')

// confirm 247 vs 248 Fr wrapper strings uniqueness
const needles = [
  'flexDirection:"column",paddingLeft:1,children:[At.warnings.map',
  'flexDirection:"column",paddingLeft:1,children:[qt.warnings.map',
  'flexDirection:"column",children:[qt.warnings.map',
  'flexDirection:"column",children:[At.warnings.map',
  'paddingLeft:Cg?1:2',
  'paddingLeft:1,children:[At.warnings',
]
for (const n of needles) {
  const a = allHits(b248, n)
  const b = allHits(b247, n)
  lines.push(
    `## needle ${JSON.stringify(n)} hits248=${a.length} hits247=${b.length} @248=${a[0] ?? -1} @247=${b[0] ?? -1}`,
  )
}
lines.push('')

// L wrapper around notice.render — any padding?
dumpAround(
  b248,
  '248 L-wrap notice',
  b248.indexOf(Buffer.from('qt.warnings.map((Qv)=>e(L,{children:Qv.render(ki)})')),
  20,
  80,
)
dumpAround(
  b247,
  '247 ne-wrap notice',
  b247.indexOf(Buffer.from('At.warnings.map((rN)=>r(ne,{children:rN.render(hl)})')),
  20,
  80,
)

writeFileSync(`${outDir}/gold-248-34-column2.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-34-column2.txt`, 'lines', lines.length)
