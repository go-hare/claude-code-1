import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  loadSea,
  sha,
} from './_peel-248-na-helpers.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const buf = loadSea(EXE_248)
const out = []
function log(s) {
  out.push(s)
  console.log(s)
}

function dumpHits(label, needle, ctx = 80) {
  const hits = allHits(buf, needle)
  log(`\n## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const [i, h] of hits.slice(0, 12).entries()) {
    log(`- #${i} @${h} ${asciiSlice(buf, h - 40, h + needle.length + ctx)}`)
  }
}

/** Walk a JS template/quoted string starting at the opening quote byte. */
function scanQuoted(openPos) {
  const q = String.fromCharCode(buf[openPos])
  if (q !== '`' && q !== '"' && q !== "'") return { miss: true, q }
  let esc = false
  let i = openPos + 1
  const max = Math.min(buf.length, openPos + 80_000)
  while (i < max) {
    const c = buf[i]
    const ch = String.fromCharCode(c)
    if (esc) {
      esc = false
      i++
      continue
    }
    if (c === 92) {
      esc = true
      i++
      continue
    }
    if (c === buf[openPos]) {
      return { openPos, closePos: i, quote: q }
    }
    i++
  }
  return { missEnd: true, q }
}

function utf8Slice(start, end) {
  return buf.subarray(start, end).toString('utf8')
}

function extractAssignAt(start) {
  const prefix = asciiSlice(buf, start, start + 12)
  const eq = prefix.indexOf('=')
  if (eq < 0) return { miss: true, prefix }
  const openPos = start + eq + 1
  const scanned = scanQuoted(openPos)
  if (scanned.miss || scanned.missEnd) return { ...scanned, prefix }
  const innerAscii = asciiSlice(buf, openPos + 1, scanned.closePos)
  const innerUtf8 = utf8Slice(openPos + 1, scanned.closePos)
  const assignAscii = asciiSlice(buf, start, scanned.closePos + 1)
  return {
    prefix,
    quote: scanned.quote,
    openPos,
    closePos: scanned.closePos,
    innerLenAscii: innerAscii.length,
    innerLenUtf8: innerUtf8.length,
    innerShaAscii: sha(innerAscii),
    innerShaUtf8: sha(innerUtf8),
    assignShaAscii: sha(assignAscii),
    headUtf8: innerUtf8.slice(0, 200),
    tailUtf8: innerUtf8.slice(-200),
    after: asciiSlice(buf, scanned.closePos, scanned.closePos + 80),
  }
}

// --- pXt ---
const PXT = 196766972
log('=== pXt at gold start ===')
const goldSlice = asciiSlice(buf, PXT, PXT + 17303)
log(`goldSlice len=${goldSlice.length} sha=${sha(goldSlice)}`)
log(`goldSlice head=${JSON.stringify(goldSlice.slice(0, 120))}`)
log(`goldSlice tail=${JSON.stringify(goldSlice.slice(-180))}`)

const pXt = extractAssignAt(PXT)
log(`pXt assign ${JSON.stringify({ ...pXt, headUtf8: pXt.headUtf8, tailUtf8: pXt.tailUtf8 }, null, 2)}`)

// previous template (fat leftover?)
const before = asciiSlice(buf, PXT - 200, PXT + 20)
log(`\n## before pXt\n${before}`)
const prevTick = buf.lastIndexOf(0x60, PXT - 2)
log(`prev backtick @${prevTick}`)
// find var name before previous template
log(`before-400: ${asciiSlice(buf, PXT - 400, PXT)}`)

// also try nearby pXt=
dumpHits('pXt=', 'pXt=`')
dumpHits('pXt var', 'pXt=')
dumpHits('o= Before writing', 'o=`Before writing a script')
dumpHits('fXt=', 'var fXt=')
dumpHits('fXt assign', 'fXt=')

// --- fXt slim prompt ---
dumpHits('fXt=', 'fXt=`')
dumpHits('fXt function', 'function fXt')
dumpHits('fXt call', 'return fXt(')
dumpHits('Workflow tool desc', 'deterministic JavaScript workflow')
dumpHits('script API and gotchas', 'script API and gotchas')
dumpHits('Load before authoring', 'Load before authoring a script')
dumpHits('workflow-authoring skill', 'workflow-authoring')

// --- xu / gme ---
const xuHits = allHits(buf, 'function xu(){')
log('\n## function xu(){ hits=' + xuHits.length)
for (const h of xuHits) {
  const fn = extractFnAt(buf, h, 2000)
  log(`@${h} ${JSON.stringify(fn)}`)
}

dumpHits('function gme', 'function gme')
dumpHits('gme()', 'gme()')

// --- T callers ---
dumpHits('getWorkflowAuthoringAutoloadMessages', 'getWorkflowAuthoringAutoloadMessages')
dumpHits('T call tengu', 'tengu_workflow_authoring_skill_autoload')

// --- ultracode skill ---
dumpHits('ultracode skill name', 'name:"ultracode"')
dumpHits('ultracode playbook', 'Workflow Orchestration Playbook')
dumpHits('See /ultracode', 'See /ultracode')
dumpHits('WORKFLOW_TOOL', 'WORKFLOW_TOOL')

// extract fXt if function
const fXtFn = allHits(buf, 'function fXt')
for (const h of fXtFn) {
  const fn = extractFnAt(buf, h, 12000)
  log(`\n## function fXt @${h}`)
  log(JSON.stringify({ ...fn, body: fn.body?.slice(0, 400) }))
  if (fn.body) {
    writeFileSync(join(__dir, 'gold-248-40-fXt.txt'), fn.body)
    log('wrote gold-248-40-fXt.txt len=' + fn.body.length + ' sha=' + fn.sha)
  }
}

// extract pXt inner if found
if (pXt && pXt.openPos != null) {
  const innerUtf8 = utf8Slice(pXt.openPos + 1, pXt.closePos)
  writeFileSync(join(__dir, 'gold-248-40-pXt-inner.txt'), innerUtf8)
  log(
    `wrote gold-248-40-pXt-inner.txt utf8Len=${innerUtf8.length} shaUtf8=${sha(innerUtf8)} shaAscii=${pXt.innerShaAscii}`,
  )
  writeFileSync(join(__dir, 'gold-248-40-pXt-assign.txt'), goldSlice)
}

// extract o= slim pointer after pXt
const oHit = buf.indexOf(Buffer.from('o=`Before writing a script'), PXT)
if (oHit >= 0) {
  const oAssign = extractAssignAt(oHit)
  log(`\n## o= slim @${oHit} ${JSON.stringify(oAssign, null, 2)}`)
  if (oAssign.openPos != null) {
    const oInner = utf8Slice(oAssign.openPos + 1, oAssign.closePos)
    writeFileSync(join(__dir, 'gold-248-40-o-slim.txt'), oInner)
    log(`wrote gold-248-40-o-slim.txt len=${oInner.length} sha=${sha(oInner)}`)
  }
}

writeFileSync(join(__dir, 'gold-248-40-extract-log.txt'), out.join('\n'))
