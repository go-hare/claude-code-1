/**
 * Peel official 248 #31 rc-reconnect-prompt host bodies.
 * Invent-ban. Gold only. No checklist/board edit.
 */
import { existsSync, writeFileSync } from 'fs'
import {
  EXE_248,
  EXE_247,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const b247 = existsSync(EXE_247) ? loadSea(EXE_247) : null
const lines = []
lines.push('# gold-248-31-official-host')
lines.push('# densable 2.1.248 #31 rc-reconnect-prompt')
lines.push(`# SEA 226708128 · 247 ${b247 ? 'present' : 'MISS'}`)
lines.push(`# when=${new Date().toISOString()}`)
lines.push('')

function extractBalancedFrom(buf, i, maxLen = 12000) {
  const win = asciiSlice(buf, i, i + maxLen)
  let depth = 0
  let inStr = null
  let esc = false
  let started = false
  for (let p = 0; p < win.length; p++) {
    const c = win[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '{') {
      depth++
      started = true
    } else if (c === '}') {
      depth--
      if (started && depth === 0) return win.slice(0, p + 1)
    }
  }
  return win
}

function walkBack(buf, needleOff, needle, lookback = 4000) {
  const start = Math.max(0, needleOff - lookback)
  const win = asciiSlice(buf, start, needleOff + needle.length)
  const idx = win.lastIndexOf(needle)
  if (idx < 0) return { abs: needleOff, miss: true, preview: win.slice(-200) }
  return { abs: start + idx, miss: false }
}

function dumpSection(title) {
  lines.push(`## ${title}`)
  lines.push('')
}

function dumpBody(tag, body, abs) {
  lines.push(`### ${tag} abs=${abs} len=${body.length} sha=${sha(body)}`)
  lines.push(body)
  lines.push('')
}

// ---- 248 known offsets from gold-248-31-host-hunt / unk-31e ----
const OFF = {
  peZeInit: 198343498,
  setOnConnect: 198351726,
  sendControlRequestPeSet: 198368815,
  sendControlCancel: 198370641,
  getPendingPromptsWire: 198353246,
  inboundGetPending: 183098959,
}

dumpSection('248 pe/Ze/ot/ye/xi init @198343498')
{
  const abs = walkBack(b248, OFF.peZeInit, 'let Pr=', 80).abs
  const body = extractBalancedFrom(b248, abs, 2500)
  dumpBody('248 pe/Ze/ot/ye/xi', body, abs)
  // also dump raw window in case extract cuts ye early
  lines.push('### 248 pe/Ze raw 1800')
  lines.push(asciiSlice(b248, OFF.peZeInit - 40, OFF.peZeInit + 1800))
  lines.push('')
}

dumpSection('248 setOnConnect @198351726')
{
  const start = walkBack(b248, OFF.setOnConnect, 'function ', 200)
  lines.push(`### walkBack function ${JSON.stringify(start)}`)
  const fn = extractFnAt(b248, start.abs, 6000)
  if (fn.body) dumpBody('248 setOnConnect extractFnAt', fn.body, start.abs)
  else {
    lines.push(`extractFnAt miss ${JSON.stringify(fn).slice(0, 300)}`)
    lines.push('')
  }
  // method form
  const meth = walkBack(b248, OFF.setOnConnect, 'setOnConnect(', 80)
  dumpBody(
    '248 setOnConnect method-ish',
    extractBalancedFrom(b248, meth.abs, 8000),
    meth.abs,
  )
  lines.push('### 248 setOnConnect raw 2500')
  lines.push(asciiSlice(b248, OFF.setOnConnect - 200, OFF.setOnConnect + 2300))
  lines.push('')
}

dumpSection('248 sendControlRequest enclosing')
{
  const start = walkBack(
    b248,
    OFF.sendControlRequestPeSet,
    'sendControlRequest(',
    800,
  )
  dumpBody(
    '248 sendControlRequest',
    extractBalancedFrom(b248, start.abs, 8000),
    start.abs,
  )
}

dumpSection('248 sendControlCancelRequest / sendControlResponse')
{
  const start = walkBack(
    b248,
    OFF.sendControlCancel,
    'sendControlResponse(',
    800,
  )
  dumpBody(
    '248 sendControlResponse+Cancel',
    extractBalancedFrom(b248, start.abs, 2500),
    start.abs,
  )
  const cancel = walkBack(
    b248,
    OFF.sendControlCancel,
    'sendControlCancelRequest(',
    80,
  )
  dumpBody(
    '248 sendControlCancelRequest',
    extractBalancedFrom(b248, cancel.abs, 1500),
    cancel.abs,
  )
}

dumpSection('248 inbound getPendingPrompts:xi wire')
{
  lines.push('### 248 wire raw 900')
  lines.push(
    asciiSlice(b248, OFF.getPendingPromptsWire - 400, OFF.getPendingPromptsWire + 500),
  )
  lines.push('')
  lines.push('### 248 handleServerControlRequest destructure raw 1200')
  lines.push(
    asciiSlice(b248, OFF.inboundGetPending - 80, OFF.inboundGetPending + 1400),
  )
  lines.push('')
}

// find initialize pending prompts usage
dumpSection('248 getPendingPrompts call sites')
for (const off of allHits(b248, 'getPendingPrompts')) {
  if (off < 170000000) continue
  lines.push(`### getPendingPrompts @${off}`)
  lines.push(asciiSlice(b248, off - 120, off + 400))
  lines.push('')
}
for (const needle of ['i?.(', 'i&&i(', 'i()?', 'pendingPrompts', 'getPendingPrompts:']) {
  // skip
}
for (const needle of ['i?.()??', 'i?.()||', '.getPendingPrompts', 'pending_prompts']) {
  const hits = allHits(b248, needle)
  lines.push(`### needle ${JSON.stringify(needle)} n=${hits.length} ${hits.filter((x) => x > 170000000).slice(0, 8)}`)
}

// hunt initialize + pending
for (const needle of [
  'pending_permission_requests',
  'pendingPrompts',
  'getPendingPrompts()',
  'i=i?.()',
  'prompts:i',
  'prompts:i?.',
]) {
  const hits = allHits(b248, needle)
  const js = hits.filter((x) => x > 170000000)
  lines.push(`### needle ${JSON.stringify(needle)} all=${hits.length} js=${js.slice(0, 12)}`)
  for (const off of js.slice(0, 3)) {
    lines.push(asciiSlice(b248, off - 80, off + 280))
    lines.push('')
  }
}

// ---- 247 twins ----
if (b247) {
  dumpSection('247 ma/Xg/kl/dP init')
  const maHits = allHits(b247, 'ma=new Map;function Xg')
  lines.push(`### ma=new Map;function Xg hits=${maHits}`)
  for (const off of maHits) {
    dumpBody('247 ma/Xg/kl/dP', extractBalancedFrom(b247, off - 40, 2200), off - 40)
  }
  const puHits = allHits(b247, 'function Pu(){zt.setOnConnect')
  lines.push(`### function Pu hits=${puHits}`)
  for (const off of puHits) {
    const fn = extractFnAt(b247, off, 8000)
    if (fn.body) dumpBody('247 Pu setOnConnect', fn.body, off)
    else dumpBody('247 Pu raw', asciiSlice(b247, off, off + 2500), off)
  }
  const sendHits = allHits(b247, 'sendControlRequest(Ue){')
  lines.push(`### 247 sendControlRequest(Ue) hits=${sendHits}`)
  for (const off of sendHits.slice(0, 2)) {
    dumpBody('247 sendControlRequest', extractBalancedFrom(b247, off, 4000), off)
  }
  const cancelHits = allHits(b247, 'sendControlCancelRequest(Ue){')
  lines.push(`### 247 sendControlCancelRequest hits=${cancelHits}`)
  for (const off of cancelHits.slice(0, 2)) {
    dumpBody('247 sendControlCancelRequest', extractBalancedFrom(b247, off, 1200), off)
  }
  dumpSection('247 inbound getPendingPrompts:dP')
  for (const off of allHits(b247, 'getPendingPrompts:dP')) {
    lines.push(`### 247 getPendingPrompts:dP @${off}`)
    lines.push(asciiSlice(b247, off - 200, off + 400))
    lines.push('')
  }
  for (const off of allHits(b247, 'getPendingPrompts:s')) {
    if (off < 200000000) continue
    lines.push(`### 247 getPendingPrompts:s @${off}`)
    lines.push(asciiSlice(b247, off - 80, off + 600))
    lines.push('')
  }
}

writeFileSync(`${outDir}/gold-248-31-official-host.txt`, lines.join('\n'))
console.log('wrote gold-248-31-official-host.txt', lines.length)
