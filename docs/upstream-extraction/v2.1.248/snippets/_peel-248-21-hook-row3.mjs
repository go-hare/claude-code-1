/**
 * #21 pass3 — is _P 248-new? waitingFor setters? fleet lastMessage from hook?
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
  '# gold-248-21-hook-row3',
  `when=${new Date().toISOString()}`,
  '',
]

function dumpHits(buf, label, needle, around = 160, cap = 10) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label}  hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(buf, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

function dumpFn(buf, label, i, maxLen = 6000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
}

// 247 vs 248 for _P signature
const pSig = 'function _P(l,d){let f=l?.trim()?l:d?.trim()?d:""'
lines.push(
  `## _P-sig 248=${allHits(b248, pSig).length} 247=${allHits(b247, pSig).length}`,
)
dumpHits(b247, '247 _P-sig', pSig, 80, 3)
dumpHits(b247, '247 Expected schema _P-ish', 'Expected schema:`', 120, 4)
dumpHits(b247, '247 hookName hook error children', 'children:[A.hookName," hook error"]', 180, 3)

// waitingFor assignments
dumpHits(b248, '248 waitingFor=', 'waitingFor:', 140, 12)
dumpHits(b248, '248 waitingFor=', 'waitingFor=', 140, 12)
dumpHits(b248, '248 lastMessage=', 'lastMessage:', 140, 8)

// updateSessionActivity / updatePidFile patches
dumpHits(b248, '248 updateSessionActivity', 'updateSessionActivity', 80, 6)
dumpHits(b248, '248 waitingFor hook', 'waitingFor:e.', 80, 8)
dumpHits(b248, '248 waitingFor t.', 'waitingFor:t', 80, 8)

// hook validation -> activity
for (const n of [
  'hookName+" hook error"',
  'hook error: ${',
  '`${e.hookName} hook error',
  '`${t.hookName} hook error',
  'hookName} hook error: ${',
  'validationError}',
  'validationError,',
  'stderr: `JSON validation failed',
]) {
  const a = allHits(b248, n).length
  const b = allHits(b247, n).length
  lines.push(`- ${JSON.stringify(n)} 248=${a} 247=${b}`)
  if (a) dumpHits(b248, n, n, 150, 4)
}

// Swt 247 vs 248
const swt247 = allHits(b247, 'function Swt(')
const swt248 = allHits(b248, 'function Swt(')
lines.push(`## Swt 248=${swt248.length} 247=${swt247.length}`)
if (swt248.length) dumpFn(b248, '248-Swt', swt248[0], 2000)
if (swt247.length) dumpFn(b247, '247-Swt', swt247[0], 2000)

// Eve prefix 247 vs 248
dumpHits(b248, '248 Eve', 'Hook JSON output validation failed', 80, 3)
dumpHits(b247, '247 Eve', 'Hook JSON output validation failed', 80, 3)

// PermissionRequest decision must be
for (const n of [
  'PermissionRequest decision must be',
  'top-level decision is the legacy',
  'hookSpecificOutput is missing required field',
]) {
  const a = allHits(b248, n).length
  const b = allHits(b247, n).length
  lines.push(`- UNIQUE? ${JSON.stringify(n)} 248=${a} 247=${b}`)
  if (a) dumpHits(b248, n, n, 180, 2)
}

// fleet helpers: jobLabel / detail format
dumpHits(b248, '248 session.waitingFor', 'session.waitingFor', 100, 6)
dumpHits(b248, '248 .waitingFor ??', '.waitingFor??', 100, 8)
dumpHits(b248, '248 .waitingFor ??', '.waitingFor ??', 100, 8)

writeFileSync(`${outDir}/gold-248-21-hook-row3.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-21-hook-row3.txt`, 'lines', lines.length)
