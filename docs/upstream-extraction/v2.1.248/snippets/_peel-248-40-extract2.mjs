import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  EXE_248,
  allHits,
  asciiSlice,
  extractFnAt,
  lastFnStartGeneric,
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
function dumpHits(label, needle, ctx = 120) {
  const hits = allHits(buf, needle)
  log(`\n## ${label} needle=${JSON.stringify(needle)} hits=${hits.length}`)
  for (const [i, h] of hits.slice(0, 10).entries()) {
    log(`- #${i} @${h} ${asciiSlice(buf, h - 60, h + needle.length + ctx)}`)
  }
}

function scanQuoted(openPos) {
  const q = String.fromCharCode(buf[openPos])
  if (q !== '`' && q !== '"' && q !== "'") return { miss: true, q }
  let esc = false
  let i = openPos + 1
  const max = Math.min(buf.length, openPos + 80_000)
  while (i < max) {
    const c = buf[i]
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
    if (c === buf[openPos]) return { openPos, closePos: i, quote: q }
    i++
  }
  return { missEnd: true, q }
}

// --- e= slim tool prompt (template immediately before pXt) ---
const PXT = 196766972
// walk backward from the backtick that closes e
const eClose = PXT - 2 // `.,`  then pXt — close backtick at PXT-2
log(`byte at PXT-2 = ${buf[PXT - 2]} ${JSON.stringify(String.fromCharCode(buf[PXT - 2]))}`)
log(`around PXT-5: ${asciiSlice(buf, PXT - 8, PXT + 4)}`)

// find e= by scanning back for assignment
const eAssignHits = []
let searchFrom = Math.max(0, PXT - 30000)
while (searchFrom < PXT) {
  const k = buf.indexOf(Buffer.from('e=`'), searchFrom)
  if (k < 0 || k >= PXT) break
  eAssignHits.push(k)
  searchFrom = k + 1
}
log(`e=\` hits before pXt: ${eAssignHits.join(', ')}`)
for (const h of eAssignHits.slice(-5)) {
  const scanned = scanQuoted(h + 2)
  log(
    `e=\` @${h} close=${scanned.closePos} len=${scanned.closePos - (h + 3)} after=${asciiSlice(buf, scanned.closePos, scanned.closePos + 20)} head=${asciiSlice(buf, h, h + 160)}`,
  )
}

dumpHits('Execute a workflow script', 'Execute a workflow script')
dumpHits('ONLY call this tool', 'ONLY call this tool when')
dumpHits('function eJ', 'function eJ')
dumpHits('eJ(', 'eJ(e?.tools)')
dumpHits('eJ(i)', 'eJ(i)')
dumpHits('eJ(r', 'eJ(r')

// T caller window
const tCall = 191185394
log('\n## T caller @191185394')
log(asciiSlice(buf, tCall - 400, tCall + 800))
const tFn = lastFnStartGeneric(buf, tCall, 8000)
log(`lastFn before T call: ${JSON.stringify(tFn)}`)
if (tFn.i >= 0) {
  const ext = extractFnAt(buf, tFn.i, 12000)
  log(`caller fn ${tFn.name} @${tFn.i} len=${ext.len} sha=${ext.sha}`)
  if (ext.body) {
    writeFileSync(join(__dir, 'gold-248-40-T-caller.txt'), ext.body)
    log('wrote gold-248-40-T-caller.txt')
    log(ext.body.slice(0, 1500))
    log('…')
    log(ext.body.slice(-800))
  }
}

// eJ extract
const eJHits = allHits(buf, 'function eJ(')
log('\n## function eJ(')
for (const h of eJHits) {
  const ext = extractFnAt(buf, h, 2000)
  log(`@${h} ${JSON.stringify(ext)}`)
}

// ultracode registration
dumpHits('hut=', 'hut="')
dumpHits('ultracode name const', '"ultracode"')
dumpHits('name hut', 'name:hut')
dumpHits('name:"ultra', 'name:"ultra')
dumpHits('registerUltracode', 'ultracode')

// K$ skill cache
dumpHits('function K$', 'function K$(')
dumpHits('IWe', 'function IWe')

writeFileSync(join(__dir, 'gold-248-40-extract2-log.txt'), out.join('\n'))
