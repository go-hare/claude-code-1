/**
 * densable 2.1.248 — peel official hosts for #24 and #31.
 * Parent: official has leftover missing → align.
 */
import { writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = [
  '# gold-248-24-31-official-host',
  `when=${new Date().toISOString()}`,
  `sea248=${b248.length} sea247=${b247.length}`,
  '',
]

function dumpNear(label, i, before, after, buf = b248) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(label, i, maxLen = 16000, buf = b248) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return
  }
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    const other = buf === b248 ? b247 : b248
    lines.push(
      `len=${ext.len} sha=${ext.sha} exactOther=${other.indexOf(Buffer.from(ext.body))}`,
    )
    lines.push(ext.body)
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
  }
  lines.push('')
}

lines.push('# ---- #31 sendControlRequest / cancel / ye / xi ----')
dumpNear('sendControlRequest-win', 198368700, 80, 2200)
dumpNear('sendControlCancel-win', 198370641, 80, 700)
dumpNear('ye-win', 198343560, 40, 900)
dumpNear('xi-win', 198343920, 40, 250)
dumpNear('Cnt-call-win', 198370200, 200, 400)

const cntHits = allHits(b248, 'function Cnt(')
lines.push(`## function Cnt( hits=${cntHits.join(',')}`)
for (const i of cntHits.slice(0, 3)) dumpFn(`Cnt @${i}`, i, 2500)

const hhtHits = allHits(b248, 'function Hht(')
lines.push(`## function Hht( hits=${hhtHits.join(',')}`)
for (const i of hhtHits.slice(0, 2)) dumpFn(`Hht @${i}`, i, 2000)

const initHits = allHits(b248, 'getPendingPrompts:')
for (const i of initHits.slice(0, 3)) {
  dumpNear(`getPendingPrompts-use @${i}`, i, 200, 800)
}

lines.push('# ---- #24 headersHelper 401 host ----')
dumpNear('401-win', 207114800, 400, 1800)
const fn24 = lastFnStartGeneric(b248, 207115285, 8000)
lines.push(`## #24 enclosing-fn name=${fn24.name} i=${fn24.i}`)
dumpFn(`#24 fn ${fn24.name}`, fn24.i, 18000)

const weNeedles = [
  'session credential rejected',
  'ye?',
  'mcp_headers_helper',
  'function ye(',
]
for (const n of weNeedles) {
  const h = allHits(b248, n)
  const h247 = allHits(b247, n).length
  lines.push(`## needle ${JSON.stringify(n)} 248=${h.length} 247=${h247}`)
}

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-24-31-official-host.txt',
  lines.join('\n'),
)
console.log('wrote', lines.length, 'lines')
