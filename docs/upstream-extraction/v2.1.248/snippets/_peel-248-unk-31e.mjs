/**
 * #31 pass5 — leftover-name needles around official pe.set / sendControlCancel
 * / Hht. Hunt leftover host names; invent-ban. No checklist/board.
 */
import { writeFileSync } from 'fs'
import {
  EXE_247,
  EXE_248,
  loadSea,
  asciiSlice,
  allHits,
  extractFnAt,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-unk-31e.txt'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = [
  '# gold-248-unk-31e  leftover-name peel',
  `when=${new Date().toISOString()}`,
  '',
]

function dump(buf, label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  lines.push(i < 0 ? 'MISS' : asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(buf, label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) {
    lines.push('MISS')
    lines.push('')
    return
  }
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    const other = buf === b248 ? b247 : b248
    const inOther = other.indexOf(Buffer.from(ext.body))
    lines.push(`len=${ext.len} sha=${ext.sha} exactOther=${inOther >= 0 ? inOther : 0}`)
    lines.push(ext.body)
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
  }
  lines.push('')
}

function cnt(buf, n) {
  return allHits(buf, n).length
}

const leftoverNeedles = [
  'Local-only retract of a declined dialog',
  'declined dialog forward',
  'getPendingPrompts',
  'onDialogKindsDeclared',
  'onClientInitialize',
  'permission_details',
  'request_user_dialog',
  'Sent control_request',
  'Sent control_cancel_request',
  'Dropping control_cancel_request',
  'pendingForwards',
  'pending_forwards',
  'locallyShown',
  'shownLocally',
  'forwardedIds',
  'dialogForward',
  'pendingControlRequests',
  'Hht(',
  'hkr(',
  'Cnt(',
]

lines.push('# ==== leftover-name counts ====')
for (const n of leftoverNeedles) {
  const a = cnt(b248, n)
  const b = cnt(b247, n)
  if (a !== b || a === 0)
    lines.push(`- ${JSON.stringify(n)} 248=${a} 247=${b}${a > 0 && b === 0 ? ' **NEW248**' : ''}`)
}
lines.push('')

// sendControlRequest pe.set windows
for (const n of [
  'pe.set(e.request_id,{request:e})',
  'pe.set(e.request_id,{request:e,details:t})',
  'Local-only retract of a declined dialog',
  'function Hht(',
  'function hkr(',
]) {
  const hits = allHits(b248, n).filter(i => i > 170000000)
  lines.push(`# -- ${JSON.stringify(n)} js=${hits}`)
  for (const i of hits.slice(0, 3)) dump(b248, `248 ${n}`, i, 200, 400)
}

// enclosing fn around first pe.set
const peSet = allHits(b248, 'pe.set(e.request_id,{request:e})').filter(
  i => i > 170000000,
)
if (peSet[0] !== undefined) {
  const st = lastFnStartGeneric(b248, peSet[0], 20000)
  lines.push(`- enclosing pe.set fn=${st.name} @${st.i}`)
  if (st.i >= 0) dumpFn(b248, '248 enclosing pe.set', st.i, 6000)
}

// Hht / hkr
for (const n of ['function Hht(', 'function hkr(', 'Hht(e)', 'hkr(Ue)']) {
  const a = allHits(b248, n).filter(i => i > 170000000)
  const b = allHits(b247, n).filter(i => i > 170000000)
  lines.push(`${JSON.stringify(n)} 248=${a} 247=${b}`)
  for (const i of a.slice(0, 2)) dump(b248, `248 ${n}`, i, 80, 200)
  for (const i of b.slice(0, 2)) dump(b247, `247 ${n}`, i, 80, 200)
}

// 247 ma.set twin
for (const n of [
  'ma.set(',
  'ma.delete(',
  'function dP()',
  'function Xg(',
]) {
  const hits = allHits(b247, n).filter(i => i > 170000000)
  lines.push(`247 ${JSON.stringify(n)} n=${hits.length} ${hits.slice(0, 6)}`)
  for (const i of hits.slice(0, 2)) dump(b247, `247 ${n}`, i, 80, 180)
}

writeFileSync(out, lines.join('\n'))
console.log('WROTE', out, 'lines', lines.length)
