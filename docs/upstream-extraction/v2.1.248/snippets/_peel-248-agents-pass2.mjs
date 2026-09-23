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

const lines = [
  '# gold-248-agents-pass2',
  `exe=${exe}`,
  `bytes=${b248.length}`,
  `when=${new Date().toISOString()}`,
  'helpers=247 _peel-1-ye-Ht-Jt-DE.mjs asciiSlice/allHits/extractFnAt',
  '',
]

function dumpHits(label, needle, around = 110, cap = 6) {
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

function dumpFn(label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(b248, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

// #12 windows env / keyboard
dumpHits('#12 function applyFleet', 'function applyFleetViewHostWindowsEnv')
dumpHits('#12 applyFleetViewHostWindowsEnv=', 'applyFleetViewHostWindowsEnv=')
dumpHits('#12 export applyFleet', 'as applyFleetViewHostWindowsEnv')
dumpHits('#12 handoffRawMode', 'handoffRawMode')
dumpHits('#12 WIN32_INPUT_MODE disable write', 'Yot')
dumpHits('#12 ?9001l', '?9001l')
dumpHits('#12 9001l', '9001l')

// #14 model as code
dumpHits('#14 JKt(', 'function JKt(')
dumpHits('#14 Dv(', 'function Dv(')
dumpHits('#14 fast-mode-toggled body', 'key:"fast-mode-toggled"')
dumpHits('#14 model-switch-fast-mode body', 'key:"model-switch-fast-mode"')
dumpHits('#14 markdown [1m]', '](1m]')
dumpHits('#14 href 1m', 'href')
dumpHits('#14 code children model', 'children:[`')

// #15 ensureAgents B
dumpFn('#15-B-ensure', b248.indexOf(Buffer.from('async function B(s,i,t){switch(i){case"skip"')), 4500)

// #16 K$n load
dumpHits('#16 async function K$n', 'async function K$n(')
dumpFn('#16-K$n', b248.indexOf(Buffer.from('async function K$n(')), 2500)
dumpFn('#16-uXe', b248.indexOf(Buffer.from('function uXe(e){let t=new Map,r;try{r=q(e)}')), 1200)

// #17 stale / resume ask
dumpHits('#17 Resume this conversation', 'Resume this conversation')
dumpHits('#17 resume saved conversation', 'saved conversation')
dumpHits('#17 confirm resume', 'confirm resume')
dumpHits('#17 lastSeenAt', 'lastSeenAt')
dumpHits('#17 lastActiveAt', 'lastActiveAt')
dumpHits('#17 heartbeat stale', 'stale heartbeat')
dumpHits('#17 host-died', 'host-died')
dumpHits('#17 EHOSTDEAD', 'EHOSTDEAD')
dumpHits('#17 weeks-old bg', 'bg session')
dumpHits('#17 stopped at its real', 'stopped at its')
dumpHits('#17 real end time', 'endedAt')
dumpHits('#17 resume overlay confirm', 'resumeConfirm')
dumpHits('#17 askResume', 'askResume')

// #18 new session typed prompt
dumpHits('#18 ye(X.origin)', 'ye(X.origin)')
dumpHits('#18 function ye(', 'function ye(')
dumpHits('#18 openNewSession', 'openNewSession')
dumpHits('#18 dispatchInput drop', 'dispatchInput')
dumpHits('#18 VIy', 'VIy')
dumpHits('#18 idle shell spawn', 'idle shell')

// #19 Wr? Open in a terminal
dumpAround('#19-Wr-row', b248.indexOf(Buffer.from('Open in a terminal')), 200, 250)
dumpHits('#19 terminalHolderOf', 'terminalHolderOf')
dumpHits('#19 resume_session_live_elsewhere', 'resume_session_live_elsewhere')

// #20 merged local default
dumpHits('#20 --merged', '--merged')
dumpHits('#20 is-ancestor', 'is-ancestor')
dumpHits('#20 worktreeHasUnpushed', 'worktreeHasUnpushed')
dumpHits('#20 unpushed gate', 'unpushed')
dumpHits('#20 merged into your', 'merged into your')
dumpHits('#20 checked-out default', 'checked-out default')
dumpHits('#20 local main', 'local main')

// #21 hook schema on agents row
dumpHits('#21 hook schema error', 'hook schema')
dumpHits('#21 invalid hook answer', 'invalid hook')
dumpHits('#21 PermissionRequest schema', 'PermissionRequest')
dumpHits('#21 hookName + schema', 'hookName')
dumpHits('#21 schema validation', 'failed schema validation')
dumpHits('#21 waiting hook', 'waiting on hook')
dumpHits('#21 hook error row', 'hook error:')

// #27 Pmr cleanup / ov
dumpHits('#27 function ov(', 'function ov(')
dumpHits('#27 await ov(', 'await ov(')
dumpHits('#27 cleanup after logs', 'cli_bg_logs')
dumpAround('#27-Pmr-after', 189642272, 20, 900)

// #28 trust dialog truncate
dumpHits('#28 TrustDialog', 'TrustDialog')
dumpHits('#28 permission rules', 'permission rules')
dumpHits('#28 repo permission', 'repo permission')
dumpHits('#28 toWellFormed trust', 'zy(')
dumpAround('#28-zy', b248.indexOf(Buffer.from('function zy(t){if(g)return g(t)')), 20, 200)

// #29 perm mode after ctrl-c
dumpHits('#29 cycleMode', 'cycleMode')
dumpHits('#29 chat:cycleMode', 'chat:cycleMode')
dumpHits('#29 exitArmed', 'exitArmed')
dumpHits('#29 Press Ctrl-C again to exit', 'Press Ctrl-C again to exit')

// #34 startup warning column
dumpAround('#34-mcp-warn-render', 201566839, 200, 250)
dumpHits('#34 render warning status', 'status:"warning"')
dumpHits('#34 paddingLeft transcript', 'paddingLeft:1')
dumpHits('#34 mcpNeedsAuthCount', 'mcpNeedsAuthCount')

// #35 worktree lock hold
dumpAround('#35-lock-reason', 186343973, 200, 400)
dumpFn('#35-lock', b248.indexOf(Buffer.from('async function Gct(')), 3500)
dumpAround('#35-bg-boot', 204223417, 250, 350)

// #36 IME mention
dumpHits('#36 IME composition', 'IME')
dumpHits('#36 mention query', 'mentionQuery')
dumpHits('#36 normalize mention', 'normalize(')
dumpHits('#36 localeCompare mention', 'localeCompare')
dumpHits('#36 toLocaleLowerCase', 'toLocaleLowerCase')

// #45 canDispatchAndOpen
dumpHits('#45 canDispatchAndOpen', 'canDispatchAndOpen')
dumpHits('#45 dispatch and open', 'dispatch and open')
dumpHits('#45 ctrl+enter key', 'ctrl+enter')

writeFileSync(`${outDir}/gold-248-agents-pass2.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-agents-pass2.txt`, 'lines', lines.length)
