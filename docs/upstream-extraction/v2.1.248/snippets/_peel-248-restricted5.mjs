/**
 * Pass 5 — rrn (initializeToolPermissionContext + restricted tool strip).
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
  loadSea,
  allHits,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-restricted-rrn',
  `bytes=${buf.length}`,
  `when=${new Date().toISOString()}`,
  '',
]

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(label, i, maxLen = 40000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

const rrn = buf.indexOf(
  Buffer.from(
    'async function rrn({allowedToolsCli:e,disallowedToolsCli:t,baseToolsCli:r,restricted:o=!1',
  ),
)
dumpAround('rrn-win', rrn, 80, 200)
dumpFn('rrn', rrn, 40000)

// also extract nearby helpers used by rrn
const nnt = buf.indexOf(Buffer.from('function Nnt(e,t){'))
dumpFn('Nnt-near-D2n', nnt, 2000)
const fnt = buf.indexOf(Buffer.from('function Fnt(e){'))
dumpFn('Fnt', fnt, 400)

// look for restricted tool name lists near rrn
const hits = []
let i = 0
const needle = Buffer.from('restricted')
while (i < buf.length) {
  const k = buf.indexOf(needle, i)
  if (k < 0) break
  if (k >= rrn && k < rrn + 20000) hits.push(k)
  i = k + needle.length
}
lines.push(`## restricted hits inside rrn window count=${hits.length}`)
for (const h of hits.slice(0, 20)) {
  lines.push(`- @${h} ${asciiSlice(buf, h - 80, h + 160)}`)
}
lines.push('')

// vd / parse tool list
const vd = buf.indexOf(Buffer.from('function vd(e){'), rrn - 50000)
dumpFn('vd-before-rrn', vd, 2000)

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-restricted-rrn.txt',
  lines.join('\n'),
)
console.log('WROTE rrn chars=', lines.join('\n').length, 'rrn=', rrn)
