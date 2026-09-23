/**
 * Peel densable 2.1.248 #29 — REPL perm-mode vs Ctrl-C exit hint.
 * Prefer PromptInput / useTextInput / cycleMode, NOT fleet footer.
 */
import { writeFileSync } from 'fs'
import {
  EXE_248,
  EXE_247,
  loadSea,
  asciiSlice,
  sha,
  allHits,
  extractFnAt,
  lastFnStart,
  lastFnStartGeneric,
} from './_peel-248-na-helpers.mjs'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const b248 = loadSea(EXE_248)
const b247 = loadSea(EXE_247)
const lines = [
  `when=${new Date().toISOString()}`,
  `sea248=${EXE_248} bytes=${b248.length}`,
  `sea247=${EXE_247} bytes=${b247.length}`,
]

function dumpHits(buf, label, needle, max = 12, before = 160, after = 280) {
  const hits = allHits(buf, needle)
  lines.push('')
  lines.push(
    `## ${label}  needle=${JSON.stringify(needle)}  hits=${hits.length}`,
  )
  for (const [n, h] of hits.slice(0, max).entries()) {
    lines.push(`- #${n} @${h} ${asciiSlice(buf, h - before, h + after)}`)
  }
  if (hits.length > max) lines.push(`- … +${hits.length - max} more`)
  return hits
}

function dumpFn(buf, label, off, maxLen = 16000) {
  const fn = lastFnStartGeneric(buf, off + 80, 12000)
  lines.push('')
  lines.push(`## ${label} lastFn=${fn.name} @${fn.i} (needle @${off})`)
  const ext = extractFnAt(buf, fn.i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else {
    lines.push(JSON.stringify(ext))
    lines.push(asciiSlice(buf, off - 200, off + 2500))
  }
  return ext
}

function dumpWin(buf, label, off, before = 400, after = 1600) {
  lines.push('')
  lines.push(`## ${label} @${off}`)
  lines.push(asciiSlice(buf, off - before, off + after))
}

// --- REPL-specific needles (not fleet "Press Ctrl-C again to exit") ---
const needles = [
  '[auto-mode] handleCycleMode',
  'tengu_mode_cycle',
  'no_other_modes',
  'remote-permission-mode-noop',
  'No other permission modes are available',
  'onExitMessage',
  'disableCtrlCClear',
  'again to exit',
  'Press ',
  'Ctrl-C',
  'shift_tab',
  'chat:cycleMode',
  'exitMessage',
  'setExitMessage',
  'showHint',
]

lines.push('', '# === 248 hits ===')
const hits248 = {}
for (const n of needles) {
  hits248[n] = dumpHits(b248, `248 ${n}`, n)
}

lines.push('', '# === 247 hits (compare) ===')
const hits247 = {}
for (const n of [
  '[auto-mode] handleCycleMode',
  'onExitMessage',
  'disableCtrlCClear',
  'again to exit',
  'tengu_mode_cycle',
  'no_other_modes',
]) {
  hits247[n] = dumpHits(b247, `247 ${n}`, n, 8)
}

// handleCycleMode unique string → extract containing function
const hcm248 = hits248['[auto-mode] handleCycleMode'] || []
const hcm247 = hits247['[auto-mode] handleCycleMode'] || []
if (hcm248[0] != null) {
  dumpFn(b248, '248-handleCycleMode-fn', hcm248[0], 24000)
  dumpWin(b248, '248-handleCycleMode-win', hcm248[0], 800, 4000)
}
if (hcm247[0] != null) {
  dumpFn(b247, '247-handleCycleMode-fn', hcm247[0], 24000)
  dumpWin(b247, '247-handleCycleMode-win', hcm247[0], 800, 4000)
}

// onExitMessage — look for REPL TextInput / useTextInput, skip dialogs
const oem248 = hits248.onExitMessage || []
for (const [i, h] of oem248.entries()) {
  dumpWin(b248, `248-onExitMessage-${i}`, h, 300, 900)
  const fn = lastFnStartGeneric(b248, h + 40, 8000)
  if (fn.i > 0) {
    lines.push(`  lastFn=${fn.name} @${fn.i}`)
  }
}

// "again to exit" — filter out fleet "Press Ctrl-C again to exit"
const ate248 = hits248['again to exit'] || []
lines.push('', '## again-to-exit classification 248')
for (const h of ate248) {
  const win = asciiSlice(b248, h - 80, h + 160)
  const isFleet =
    win.includes('Press Ctrl-C again to exit') ||
    win.includes('will keep running') ||
    win.includes('press ctrl+c or q again')
  lines.push(`- @${h} fleet=${isFleet} ${win}`)
}

// disableCtrlCClear — likely TextInput props near onExitMessage
const dcc248 = hits248.disableCtrlCClear || []
for (const h of dcc248.slice(0, 4)) {
  dumpWin(b248, '248-disableCtrlCClear', h, 400, 1200)
  dumpFn(b248, '248-disableCtrlCClear-fn', h, 20000)
}

// Look for compiled "Press "+key+" again to exit" near PromptInput
for (const n of [
  ' again to exit',
  '",k," again to exit',
  '",q," again to exit',
  '," again to exit"',
  ' again to exit"',
  'Press ",',
  'children:["Press "',
  'children:["Press ",',
]) {
  dumpHits(b248, `248 tmpl ${n}`, n, 8, 80, 160)
}

// Compare handleCycleMode windows sha
if (hcm248[0] != null && hcm247[0] != null) {
  const w248 = asciiSlice(b248, hcm248[0] - 2000, hcm248[0] + 6000)
  const w247 = asciiSlice(b247, hcm247[0] - 2000, hcm247[0] + 6000)
  lines.push('')
  lines.push(`## handleCycleMode-window sha248=${sha(w248)} sha247=${sha(w247)} same=${w248 === w247}`)
}

writeFileSync(`${outDir}/gold-248-29-repl.txt`, lines.join('\n'))
console.log('wrote', `${outDir}/gold-248-29-repl.txt`, 'lines', lines.length)
