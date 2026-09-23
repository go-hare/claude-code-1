/**
 * #21 pass4 — extract UFe waitingFor source; 247 vs 248; Owt/validateHookJson.
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
const lines = ['# gold-248-21-hook-row4', `when=${new Date().toISOString()}`, '']

function dumpFn(buf, label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(buf, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpAround(label, buf, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(buf, i - before, i + after))
  lines.push('')
}

// UFe / lq waitingFor
const ufe = b248.indexOf(Buffer.from('function UFe(d){if(d.workerSandboxPrompt)return"sandbox request"'))
dumpFn(b248, '248-UFe', ufe, 4000)
dumpFn(b248, '248-lq', b248.indexOf(Buffer.from('function lq(d){let C=UFe(d)')), 800)

const ufe247 = allHits(b247, 'function UFe(')
const lq247 = allHits(b247, 'workerSandboxPrompt)return"sandbox request"')
lines.push(`## 247 UFe hits=${ufe247.length} sandbox-waiting=${lq247.length}`)
for (const i of lq247.slice(0, 2)) {
  const start = lastFnStartGeneric(b247, i + 20, 2000)
  dumpFn(b247, `247-waitingFor-${start.name}`, start.i, 4000)
}

// Owt = validateHookJson?
dumpFn(b248, '248-Owt', b248.indexOf(Buffer.from('function Owt(')), 2500)
dumpFn(b248, '248-kwt', b248.indexOf(Buffer.from('function kwt(')), 2000)
dumpFn(b248, '248-ywt', b248.indexOf(Buffer.from('function ywt(')), 800)
dumpFn(b248, '248-bwt', b248.indexOf(Buffer.from('function bwt(')), 1500)
dumpFn(b248, '248-_wt', b248.indexOf(Buffer.from('function _wt(')), 500)

// 247 validateHookJson / Eve body
const eve247 = b247.indexOf(Buffer.from('Hook JSON output validation failed \\u2014'))
dumpAround('247-Eve-raw', b247, eve247, 40, 20)
const eve247b = b247.indexOf(Buffer.from('Hook JSON output validation failed'))
dumpAround('247-Eve', b247, eve247b, 200, 600)
const start247 = lastFnStartGeneric(b247, eve247b + 20, 4000)
dumpFn(b247, `247-validate-${start247.name}`, start247.i, 3500)

// AttachmentMessage hook_non_blocking in 247
dumpAround(
  '247-hook-error-children',
  b247,
  b247.indexOf(Buffer.from('hook error')),
  80,
  80,
)
const nW = b247.indexOf(Buffer.from('function nW(e,r){let n=e?.trim()?e:r?.trim()?r:""'))
dumpFn(b247, '247-nW', nW, 800)
dumpAround('247-nW-callers', b247, nW, 600, 40)

// search 248 UFe body for hook
const ufeBody = extractFnAt(b248, ufe, 4000)
if (ufeBody.body) {
  const keys = ['hook', 'schema', 'Permission', 'PreTool', 'validation', 'error']
  lines.push('## UFe contains')
  for (const k of keys) {
    lines.push(`- ${k}: ${ufeBody.body.includes(k)}`)
  }
  lines.push('')
}

writeFileSync(`${outDir}/gold-248-21-hook-row4.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-21-hook-row4.txt`, 'lines', lines.length)
