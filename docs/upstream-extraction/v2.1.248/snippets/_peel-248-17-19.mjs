/**
 * Peel densable 2.1.248 #17 + #19 (stale-resurrect + already-open terminal).
 * Gold offsets from gold-248-agents-bodies.txt / gold-248-agents-pass2.txt.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  allHits,
  extractFnAt,
  lastFnStart,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const buf = loadSea(EXE_248)
const lines = [
  `exe=${EXE_248}`,
  `bytes=${buf.length}`,
  `when=${new Date().toISOString()}`,
]

function dumpWin(label, off, before = 400, after = 1200) {
  lines.push('')
  lines.push(`## ${label} @${off}`)
  lines.push(asciiSlice(buf, off - before, off + after))
}

function dumpFn(label, off, maxLen = 12000) {
  const fn = lastFnStartGeneric(buf, off + 80, 8000)
  lines.push('')
  lines.push(`## ${label} lastFn=${fn.name} @${fn.i} (needle @${off})`)
  const ext = extractFnAt(buf, fn.i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else {
    lines.push(JSON.stringify(ext))
    dumpWin(`${label}-fallback`, off, 200, 2500)
  }
}

// #19
dumpWin('terminalHolderOf', 192133382, 200, 800)
dumpFn('terminalHolderOf-fn', 192133382, 4000)
dumpWin('Wr-row', 192201067, 800, 1600)
dumpWin('heldInTerminal-row', 192213354, 400, 800)
dumpWin('heldInTerminal-rp', 192274853, 400, 800)
dumpWin('open-path', 192188196, 600, 2500)
dumpWin('error-handler', 192189920, 400, 1500)

// #19 already-open leftover (KEEP, do not rewrite as product)
dumpWin('resume_session_live_elsewhere-respawn', 189673732, 400, 1200)

// #17
dumpWin('stderr-ended-while-bg-off', 189646403, 400, 800)
dumpWin('dead_epoch_error', 189672901, 800, 2000)
dumpFn('dead_epoch-fn', 189672901, 20000)
dumpWin('fleet-row-strings', 192184216, 800, 1200)
dumpWin('saved-conversation-stringtable', 92716655, 200, 800)
dumpWin('error-stringtable', 93500779, 200, 800)

// terminalHolders map
for (const n of [
  'terminalHolders',
  'deadEpochReapedAt',
  'dead_epoch_transcript_gone',
  'heldInTerminal',
]) {
  const hits = allHits(buf, n)
  lines.push('')
  lines.push(`## hits ${n} count=${hits.length} ${hits.slice(0, 12).join(',')}`)
  for (const h of hits.slice(0, 8)) {
    lines.push(`-- @${h}`)
    lines.push(asciiSlice(buf, h - 80, h + 220))
  }
}

// Look for class field / constructor of terminalHolders
const thHits = allHits(buf, 'terminalHolders:')
lines.push('')
lines.push(`## terminalHolders: hits=${thHits.length}`)
for (const h of thHits) {
  lines.push(`-- @${h}`)
  lines.push(asciiSlice(buf, h - 120, h + 280))
}

writeFileSync(`${outDir}/gold-248-17-19.txt`, lines.join('\n'))
console.log('wrote', `${outDir}/gold-248-17-19.txt`, 'lines', lines.length)
