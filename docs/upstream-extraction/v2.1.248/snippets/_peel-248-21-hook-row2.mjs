/**
 * #21 pass2 — 248-only PermissionRequest/PreToolUse/hook_non_blocking
 * plus fleet-region schema and _P(Expected schema) display.
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

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)

const lines = [
  '# gold-248-21-hook-row2',
  `when=${new Date().toISOString()}`,
  '',
]

function dumpAround(label, buf, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

function dumpFn(label, buf, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function newHits(needle) {
  const a = allHits(b248, needle)
  const bset = new Set(
    allHits(b247, needle).map(i => asciiSlice(b247, i - 80, i + needle.length + 80)),
  )
  const fresh = []
  for (const i of a) {
    const win = asciiSlice(b248, i - 80, i + needle.length + 80)
    if (!bset.has(win)) fresh.push({ i, win })
  }
  return { total248: a.length, fresh }
}

for (const n of [
  'PermissionRequest hook',
  'PreToolUse hook',
  'hook_non_blocking_error',
  'Expected schema:',
  'Hook JSON output validation failed',
  'JSON validation failed',
]) {
  const { total248, fresh } = newHits(n)
  lines.push(
    `## NEW-WINDOW ${JSON.stringify(n)} 248=${total248} freshWindows=${fresh.length}`,
  )
  for (const [idx, h] of fresh.slice(0, 12).entries()) {
    lines.push(`- #${idx} @${h.i} ${h.win}`)
  }
  lines.push('')
}

// fleet schema hits
for (const i of [191890856, 191902797, 192391229, 192391300, 192391426, 192391489, 192391765]) {
  dumpAround(`fleet-schema`, b248, i, 200, 250)
}

// waitingFor in fleet
dumpAround('fleet-waitingFor', b248, 192120439, 300, 400)

// _P Expected schema UI
const pHit = b248.indexOf(Buffer.from('function _P(l,d){let f=l?.trim()?l:d?.trim()?d:""'))
dumpFn('_P-schema-first-line', b248, pHit, 1500)
dumpAround('_P-callers-before', b248, pHit, 800, 80)

// find all _P( usages near hook error UI
const pCall = allHits(b248, '_P(A.stderr,A.stdout)')
lines.push(`## _P(A.stderr,A.stdout) hits=${pCall.length}`)
for (const i of pCall) {
  dumpAround(`_P-call`, b248, i, 250, 200)
}

// hook error UI children that include schema extract
for (const n of [
  'children:[A.hookName," hook error"]',
  'children:[A.hookName," hook returned blocking error"]',
  'Expected schema:`',
  'gt(f,`',
]) {
  const hits = allHits(b248, n)
  lines.push(`## ${JSON.stringify(n)} hits=${hits.length} @${hits.join(',')}`)
}

// search fleet-ish for hookName / schema error templates
const fleetStart = 191500000
const fleetEnd = 192800000
const fleetSliceNeedles = [
  'hookName',
  'hook error',
  'schema',
  'validationError',
  'Expected schema',
  'hookEvent',
  'PermissionRequest',
  'PreToolUse',
  'waitingFor',
  'lastMessage',
  'detail',
]
lines.push('## fleet-wide 191.5-192.8M')
for (const n of fleetSliceNeedles) {
  const hits = allHits(b248.subarray(fleetStart, fleetEnd), n).map(i => i + fleetStart)
  if (hits.length)
    lines.push(`- ${JSON.stringify(n)} ${hits.length} @${hits.slice(0, 10).join(',')}`)
}
lines.push('')

// dump fleet hookName / PermissionRequest / PreToolUse if any
for (const n of ['hookName', 'PermissionRequest', 'PreToolUse', 'hook error', 'validationError']) {
  const hits = allHits(b248.subarray(fleetStart, fleetEnd), n).map(i => i + fleetStart)
  for (const i of hits.slice(0, 6)) dumpAround(`fleet-${n}`, b248, i, 160, 180)
}

// 248-only string literals that mention hook + schema together
const combos = [
  'hookName+" hook error"',
  ' hook error · ',
  ' hook: ',
  'schema:',
  'failed schema',
  'invalid JSON',
  'validation failed',
]
lines.push('## combo counts 248/247')
for (const n of combos) {
  const a = allHits(b248, n).length
  const b = allHits(b247, n).length
  lines.push(`- ${JSON.stringify(n)} 248=${a} 247=${b}`)
}
lines.push('')

// Eve / ywt — #22 leftover, dump only to exclude
dumpAround('Eve-ywt', b248, 186234668, 80, 500)

// PermissionRequest hook JS (not proto) — extract covering fns for JS-looking new hits
for (const i of allHits(b248, 'PermissionRequest hook')) {
  const win = asciiSlice(b248, i - 40, i + 120)
  if (win.includes('function') || win.includes('return') || win.includes('${') || win.includes('`')) {
    dumpAround('PR-hook-js', b248, i, 200, 250)
    const start = lastFnStartGeneric(b248, i, 6000)
    if (start.i >= 0) dumpFn(`PR-hook-fn-${start.name}`, b248, start.i, 4000)
  }
}

writeFileSync(`${outDir}/gold-248-21-hook-row2.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-21-hook-row2.txt`, 'lines', lines.length)
