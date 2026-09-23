import { appendFileSync } from 'fs'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = ['', '# --- pass5 wn gt ZSt ---', '']

function peel(i, ml = 6000) {
  const ext = extractFnAt(buf, i, ml)
  lines.push(`@${i} sha=${ext.sha || '?'} len=${ext.len || '?'}`)
  lines.push(
    ext.body
      ? ext.body.length > 2500
        ? ext.body.slice(0, 2500) + '…'
        : ext.body
      : asciiSlice(buf, i, i + 200),
  )
  lines.push('')
}

function near(label, needle, lo = 179400000, hi = 179600000) {
  const hits = allHits(buf, needle)
  const n = hits.filter(i => i > lo && i < hi)
  lines.push(
    `## ${label} needle=${JSON.stringify(needle)} near=${n.length} total=${hits.length}`,
  )
  for (const i of (n.length ? n : hits).slice(0, 3)) peel(i)
}

near('async wn', 'async function wn(')
near('function wn', 'function wn(')
near('async gt', 'async function gt(')
near('function gt', 'function gt(')
near('ZSt=', 'ZSt="')
near('ZSt2', 'ZSt=')
near('$Me', 'function $Me(')
near('nx', 'function nx(')
near('nyn', 'function nyn(')

const needle = Buffer.from('layer:"user"}),projectSettings')
let from = 0
const hits = []
while (from < buf.length) {
  const k = buf.indexOf(needle, from)
  if (k < 0) break
  hits.push(k)
  from = k + needle.length
}
lines.push(`## Se keys hits=${hits.length}`)
for (const i of hits.slice(0, 3)) {
  lines.push(`@${i}`)
  lines.push(asciiSlice(buf, i - 220, i + 400))
  lines.push('')
}

appendFileSync(
  new URL('./gold-248-Vjt-T-O-seed.txt', import.meta.url),
  lines.join('\n'),
)
console.log('pass5', lines.length)
