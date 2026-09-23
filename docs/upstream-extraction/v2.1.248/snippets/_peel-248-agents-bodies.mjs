// Reuse 247 peel helpers from _peel-1-ye-Ht-Jt-DE.mjs
import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const exe =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const b248 = readFileSync(exe)

function asciiSlice(buf, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(buf.length, end)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (i < buf.length) {
    const k = buf.indexOf(n, i)
    if (k < 0) break
    hits.push(k)
    i = k + n.length
  }
  return hits
}

function extractFnAt(buf, i, maxLen = 8000) {
  if (i < 0) return { miss: true }
  const win = asciiSlice(buf, i, i + maxLen)
  const paren = win.indexOf('(')
  if (paren < 0) return { i, missEnd: true }
  let depth = 0
  let inStr = null
  let esc = false
  let closeParen = -1
  for (let p = paren; p < win.length; p++) {
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
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) {
        closeParen = p
        break
      }
    }
  }
  if (closeParen < 0) return { i, missEnd: true, preview: win.slice(0, 220) }
  const bodyStart = win.indexOf('{', closeParen)
  if (bodyStart < 0) return { i, missEnd: true, preview: win.slice(0, 220) }
  depth = 0
  inStr = null
  esc = false
  for (let p = bodyStart; p < win.length; p++) {
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
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const body = win.slice(0, p + 1)
        return { i, body, sha: sha(body), len: body.length }
      }
    }
  }
  return { i, missEnd: true, preview: win.slice(0, 280) }
}

function lastFnStart(before, names) {
  let best = -1
  let name = ''
  for (const n of names) {
    const needle = Buffer.from(n)
    let i = Math.max(0, before - 200000)
    while (i < before) {
      const k = b248.indexOf(needle, i)
      if (k < 0 || k >= before) break
      if (k > best) {
        best = k
        name = n
      }
      i = k + needle.length
    }
  }
  return { i: best, name }
}

const lines = [
  '# gold-248-agents-bodies',
  `exe=${exe}`,
  `bytes=${b248.length}`,
  `when=${new Date().toISOString()}`,
  'helpers=247 _peel-1-ye-Ht-Jt-DE.mjs extractFnAt/lastFnStart/allHits',
  '',
]

function dumpHits(label, needle, around = 100, cap = 6) {
  const hits = allHits(b248, needle)
  lines.push(`## ${label}  needle=${JSON.stringify(needle)}  hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(b248, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b248, i - before, i + after))
  lines.push('')
}

function dumpFn(label, i, maxLen = 6000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(b248, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpCovering(label, hit, names, maxLen = 8000) {
  const found = lastFnStart(hit, names)
  lines.push(`## ${label} hit@${hit} fn=${found.name || 'MISS'} @${found.i}`)
  if (found.i < 0) {
    lines.push('NO_FN')
    lines.push('')
    return
  }
  dumpFn(`${label}-body ${found.name}`, found.i, maxLen)
}

const FN = [
  'async function ',
  'function ',
  'function T(',
  'function B(',
  'function Nj(',
  'async function Pmr(',
  'function CH(',
  'function Hj(',
]

// extra unique needles missed in pass1
dumpHits('#12 applyFleetViewHostWindowsEnv', 'applyFleetViewHostWindowsEnv')
dumpHits('#12 WIN32_INPUT_MODE', 'WIN32_INPUT_MODE')
dumpHits('#12 Yot=Hj(wf.WIN32_INPUT_MODE)', 'Yot=Hj(wf.WIN32_INPUT_MODE)')
dumpHits('#14 showFastModeNotice', 'showFastModeNotice')
dumpHits('#14 fast-mode-toggled', 'fast-mode-toggled')
dumpHits('#14 model-switch-fast-mode', 'model-switch-fast-mode')
dumpHits('#14 `sonnet[1m]`', '`sonnet[1m]`')
dumpHits('#14 children model code', 'as code')
dumpHits('#16 loadPrStatusCache', 'loadPrStatusCache')
dumpHits('#16 persistPrStatusCache', 'persistPrStatusCache')
dumpHits('#17 weeks', 'weeks')
dumpHits('#17 ask before', 'ask before')
dumpHits('#17 Resume?', 'Resume?')
dumpHits('#18 willInsertNewline', 'willInsertNewline')
dumpHits('#19 Open in a terminal', 'Open in a terminal')
dumpHits('#19 continue it there', 'continue it there')
dumpHits('#19 already open in another running', 'already open in another running')
dumpHits('#20 unpushed:', 'unpushed:')
dumpHits('#21 hookName schema', 'schema')
dumpHits('#21 waitingFor hook', 'waitingFor')
dumpHits('#27 cli_bg_logs', 'cli_bg_logs')
dumpHits('#27 async function Pmr', 'async function Pmr(')
dumpHits('#27 function Nj(', 'function Nj(')
dumpHits('#28 mid-emoji changelog', 'cut off mid-emoji')
dumpHits('#34 MCP server needs', 'server needs')
dumpHits('#34 servers need', 'servers need')
dumpHits('#35 no worktree lock names', 'no worktree lock names this process')
dumpHits('#35 git worktree lock --reason', 'worktree","lock"')
dumpHits('#36 composition', 'composition')
dumpHits('#45 ctrl+enter to start and open', 'ctrl+enter to start and open')
dumpHits('#45 $f)no.push("ctrl+enter', '$f)no.push("ctrl+enter')

// --- extract covering bodies ---
const win32 = b248.indexOf(Buffer.from('WIN32_INPUT_MODE:9001'))
dumpAround('#12-WIN32_INPUT_MODE-win', win32, 80, 400)
dumpCovering('#12-WIN32', win32, FN, 2500)

const yot = b248.indexOf(Buffer.from('Yot=Hj(wf.WIN32_INPUT_MODE)'))
dumpAround('#12-Yot-disable', yot, 40, 300)

const fleetWin = b248.indexOf(Buffer.from('applyFleetViewHostWindowsEnv'))
dumpAround('#12-applyFleetViewHostWindowsEnv', fleetWin, 80, 200)
for (const i of allHits(b248, 'applyFleetViewHostWindowsEnv').slice(0, 4)) {
  dumpCovering(`#12-fleetWin@${i}`, i, FN, 4000)
}

const tTrust = b248.indexOf(
  Buffer.from('function T(){if(Me(!1)||Boolean(a.IS_DEMO)||a.CLAUBBIT)return"skip"'),
)
dumpFn('#15-agentsTrustDecision-T', tTrust, 3500)
dumpAround('#15-T-win', tTrust, 20, 1200)

const loadPr = b248.indexOf(Buffer.from('loadPrStatusCache'))
dumpAround('#16-loadPrStatusCache-win', loadPr, 80, 250)
for (const i of allHits(b248, 'loadPrStatusCache').slice(0, 4)) {
  dumpCovering(`#16-loadPr@${i}`, i, ['loadPrStatusCache(', 'function ', 'async function '], 5000)
}

const persistPr = b248.indexOf(Buffer.from('persistPrStatusCache'))
dumpAround('#16-persistPrStatusCache-win', persistPr, 80, 250)
for (const i of allHits(b248, 'persistPrStatusCache').slice(0, 3)) {
  dumpCovering(`#16-persistPr@${i}`, i, ['persistPrStatusCache(', 'function ', 'async function '], 4000)
}

const openTerm = b248.indexOf(Buffer.from('Open in a terminal'))
dumpAround('#19-Open-in-a-terminal', openTerm, 80, 200)
dumpCovering('#19-OpenTerm', openTerm, FN, 8000)

const alreadyOpen = b248.indexOf(
  Buffer.from('This conversation is already open in another running Claude session'),
)
dumpAround('#19-already-open-conv', alreadyOpen, 120, 200)
dumpCovering('#19-alreadyOpen', alreadyOpen, FN, 6000)

const unpushed = b248.indexOf(
  Buffer.from('unpushed:"has commits that are not pushed anywhere"'),
)
dumpAround('#20-unpushed-map', unpushed, 40, 200)
dumpCovering('#20-unpushed', unpushed, FN, 8000)

const pmr = b248.indexOf(Buffer.from('async function Pmr('))
dumpFn('#27-Pmr-logs', pmr, 8000)
dumpAround('#27-Pmr-win', pmr, 20, 800)

const nj = b248.indexOf(Buffer.from('function Nj(){Dcn()?.cleanupTerminalModes()}'))
dumpFn('#27-Nj-cleanup', nj, 400)

const midEmoji = b248.indexOf(Buffer.from('cut off mid-emoji'))
dumpAround('#28-mid-emoji-context', midEmoji, 200, 80)

const ctrlC = b248.indexOf(Buffer.from('Press Ctrl-C again to exit'))
dumpAround('#29-ctrlc-ui', ctrlC, 80, 250)
dumpCovering('#29-ctrlc', 192217064, FN, 4000)

const wtLock = b248.indexOf(
  Buffer.from('no worktree lock names this process'),
)
dumpAround('#35-wt-lock-warn', wtLock, 120, 200)
dumpCovering('#35-wtLock', wtLock, FN, 6000)

const ctrlEnter = b248.indexOf(Buffer.from('ctrl+enter to start and open'))
dumpAround('#45-ctrl-enter-hint', ctrlEnter, 80, 200)
dumpCovering('#45-ctrlEnter', 192220684, FN, 4000)

writeFileSync(`${outDir}/gold-248-agents-bodies.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-agents-bodies.txt`, 'lines', lines.length)
