/**
 * Peel densable 2.1.248 #44 — wZe + socket-dir fallback + /status.
 * NEVER HAVE — peel only. Do not invent /tmp/claude-$USER.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
  lastFnStart,
} from './_peel-248-na-helpers.mjs'

const buf = loadSea(EXE_248)
const lines = [
  '# gold-248-44-wze  densable 2.1.248 #44',
  `# bytes=${buf.length}`,
  `# when=${new Date().toISOString()}`,
  '# NEVER HAVE — peel only',
  '',
]

function dumpHits(label, needle, max = 12, win = 220) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label}  needle=${JSON.stringify(needle)}  hits=${hits.length}`)
  for (const h of hits.slice(0, max)) {
    lines.push(`- @${h} ${asciiSlice(buf, h - 80, h + win)}`)
  }
  if (hits.length > max) lines.push(`- … +${hits.length - max} more`)
  lines.push('')
  return hits
}

dumpHits('wZe fn', 'function wZe(')
dumpHits('lastStartFailureDetail assign', 'lastStartFailureDetail=')
dumpHits('lastStartFailureDetail name', 'lastStartFailureDetail')
dumpHits('lastStartFailureCause assign', 'lastStartFailureCause=')
dumpHits('socket_dir_refused', 'socket_dir_refused')
dumpHits('Cross-session messaging is off', 'Cross-session messaging is off')
dumpHits('its socket directory could not be set up', 'its socket directory could not be set up')
dumpHits('run with --debug-file', 'run with --debug-file')
dumpHits('cross-session-messaging-off', 'cross-session-messaging-off')
dumpHits('XDG_RUNTIME_DIR', 'XDG_RUNTIME_DIR')
dumpHits('CLAUDE_CODE_TMPDIR', 'CLAUDE_CODE_TMPDIR')
dumpHits('TMPDIR', 'TMPDIR')
dumpHits('per-user /tmp', 'per-user /tmp')
dumpHits('claude-$USER', 'claude-$USER')
dumpHits('claude-${', 'claude-${')
dumpHits('/tmp/claude-', '/tmp/claude-')
dumpHits('Point XDG_RUNTIME_DIR', 'Point XDG_RUNTIME_DIR')

const wze = extractFnAt(buf, 201218895, 4000)
lines.push('## EXTRACT wZe @201218895')
lines.push(`len=${wze.len} sha=${wze.sha} miss=${wze.miss || wze.missEnd || false}`)
if (wze.body) lines.push(wze.body)
else lines.push(JSON.stringify(wze))
lines.push('')

const ufWin = asciiSlice(buf, 201567000, 201568200)
lines.push('## Uf/Bf window @201567000')
lines.push(ufWin)
lines.push('')

// lastStartFailureDetail assignment sites
const detailHits = allHits(buf, 'lastStartFailureDetail')
for (const h of detailHits) {
  const around = asciiSlice(buf, h - 400, h + 400)
  if (around.includes('=') && (around.includes('socket') || around.includes('refused') || around.includes('function'))) {
    lines.push(`## lastStartFailureDetail window @${h}`)
    lines.push(around)
    lines.push('')
  }
}

// extract functions near lastStartFailureCause=
const causeAssign = allHits(buf, 'lastStartFailureCause=')
for (const h of causeAssign) {
  const fn = lastFnStart(buf, h, [
    'async function ',
    'function ',
  ])
  lines.push(`## lastStartFailureCause= @${h} lastFn=${fn.name} @${fn.i}`)
  if (fn.i >= 0) {
    const extracted = extractFnAt(buf, fn.i, 12000)
    lines.push(`len=${extracted.len} sha=${extracted.sha} miss=${extracted.miss || extracted.missEnd || false}`)
    if (extracted.body) lines.push(extracted.body.slice(0, 6000))
    else lines.push(asciiSlice(buf, fn.i, fn.i + 2500))
  } else {
    lines.push(asciiSlice(buf, h - 800, h + 800))
  }
  lines.push('')
}

// /status + wZe together
const statusHits = allHits(buf, '/status')
let statusNearWze = 0
for (const h of statusHits) {
  const win = asciiSlice(buf, h - 300, h + 300)
  if (win.includes('wZe') || win.includes('lastStartFailure') || win.includes('socket directory')) {
    statusNearWze++
    lines.push(`## /status near failure @${h}`)
    lines.push(win)
    lines.push('')
  }
}
lines.push(`## /status near lastStart/wZe count=${statusNearWze}`)
lines.push('')

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-44-wze.txt',
  lines.join('\n'),
)
console.log('wrote gold-248-44-wze.txt lines', lines.length)
